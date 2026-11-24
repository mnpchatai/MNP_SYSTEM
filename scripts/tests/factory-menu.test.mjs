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
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/qa-pages.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
];
const DEPT_FILES = ["st", "sr", "qa", "gr", "pt", "bg", "pk", "wh"].map((dept) => `modules/module-${dept}.js`);
const ALL_DEPTS = ["FACTORY_ST", "FACTORY_SR", "FACTORY_QA", "FACTORY_GR", "FACTORY_PT", "FACTORY_BG", "FACTORY_PK", "FACTORY_WH"];
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

const labelsOf = (html) => [...html.matchAll(/<a href="#\/([^"]+)">([^<]+)<\/a>/g)].map((match) => match[2]);
const DEPT_LABELS = Object.freeze({ FACTORY_ST: "คลังวัตถุดิบ (ST)", FACTORY_SR: "คลังยางเส้นยาว (SR)", FACTORY_QA: "ตรวจคุณภาพ (QA)", FACTORY_GR: "แปรรูปยาง (GR)", FACTORY_PT: "ขึ้นรูปพลาสติก (PT)", FACTORY_BG: "เย็บจักร (BG)", FACTORY_PK: "ประกอบและบรรจุ (PK)", FACTORY_WH: "คลังสินค้าสำเร็จรูป (WH)" });
// การ์ดของ "งานของฉัน" ที่กระดานงานของผู้ใช้ BOM คนเดียวกันวาด (หน้า "งานของฉัน" ไม่อยู่ใน BOM แล้ว: เทียบกับ workBoard + boardCards โดยตรง) · query มี dept=… ให้ฝ่ายวางแผนดูแผนกนั้น
const workPage = async (env, query = "p=work") => {
  const hub = env.context.MNP_BOM_PAGES.hub;
  const ctx = env.context.MNP_BOM.context(new URLSearchParams(query));
  const { taskCards, cards } = hub.boardCards(ctx, hub.workBoard(ctx, new URLSearchParams(query)));
  return { html: [...taskCards, ...cards].join("") };
};
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
// เมนูข้างของโมดูล (nav[0].subnav) ตอนที่หน้านั้นเปิดอยู่: อ่านรายการกลับเป็นข้อมูล
const navOf = (env, code) => {
  const item = env.modules[code].nav[0];
  const html = item.subnav(item.path);
  const items = [...html.matchAll(/<a class="rf-nav-item( is-active)?" href="([^"]*)"( aria-current="page")?>[\s\S]*?<span class="rf-nav-text">([^<]*)<\/span>(?:<span class="rf-nav-count"[^>]*>(\d+)<\/span>)?<\/a>/g)]
    .map((match) => ({ label: match[4], href: match[2], active: Boolean(match[1]), current: Boolean(match[3]), count: match[5] ? Number(match[5]) : 0 }));
  return { html, items };
};
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
  // งานของฉันอยู่ในโมดูลของแผนก (เจ้าของสั่ง 2026-11-19: เอาออกจาก BOM) จึงไม่มีลิงก์กลับไปหน้า BOM งานของฉัน · หัวหน้า = ชื่อรายการเมนูที่เปิดอยู่
  for (const [code, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /#\/bom\?p=work/, `${code} has no link to a BOM work page`);
    assert.equal(h1Of(html), "งานของฉัน", `${code} opens on งานของฉัน`);
    assert.doesNotMatch(html, /role="tablist"|class="rf-tab[ "]/, `${code} has no in-page tabs`);
  }
  assert.doesNotMatch(pages.FACTORY_QA, /#\/rubberflow\?p=(quality|spc|trace)/, "the QA module no longer sends anyone to the RubberFlow quality pages");
});

// หน้าคลัง (SR ST WH): ไม่มีแท็บในหน้า · เมนูข้างมี "งานของฉัน" (ค่าตั้งต้นเสมอ) กับ "ในคลัง" (?tab=stock) · h1 = ชื่อรายการเมนูที่เปิดอยู่
// ค้นหา/แสดงเพิ่ม/ทั้งทะเบียนอยู่ในมุมมองในคลัง (?tab=stock) ลิงก์ในหน้าพา tab ไปด้วย
test("SR: no tabs on the page; it opens on งานของฉัน with the task cards, the store view lists only the rods in the store, searchable", async () => {
  const env = load({ employee: emp("SR") });
  const lots = env.store.data().rodLots;
  const stored = lots.filter((lot) => lot.status === "stored");
  const pending = lots.filter((lot) => lot.status === "pending");
  assert.ok(stored.length >= 2 && pending.length >= 1, "the demo seed has stored and pending rod lots");
  env.store.setUser("B11"); // SR
  const html = await env.open("FACTORY_SR");
  assert.equal(h1Of(html), "งานของฉัน");
  assert.doesNotMatch(html, /role="tablist"|class="rf-tab[ "]/, "the in-page tabs are gone");
  assert.match(html, /รอรับเข้าคลัง/, "the task cards are the page");
  for (const lot of stored) assert.ok(!html.includes(`>${escapeHtml(lot.lotNo)}</span><div`), "the store table is not on the work view");
  assert.doesNotMatch(html, /#\/bom\?p=work/, "no link back to BOM: งานของฉัน lives in the module");
  // มุมมองในคลัง: ล็อตที่รับเข้าแล้วเท่านั้น
  const store = await env.open("FACTORY_SR", "tab=stock");
  assert.equal(h1Of(store), "ในคลัง");
  for (const lot of stored) assert.ok(store.includes(escapeHtml(lot.lotNo)), `stored lot ${lot.lotNo} is listed`);
  for (const lot of pending) assert.ok(!store.includes(escapeHtml(lot.lotNo)), "a pending lot is not stock yet");
  assert.match(store, /สต็อกกลาง/);
  assert.match(store, /href="#\/bom\?p=orders&amp;sel=DEMO-26006"/, "rods held for an order link to that order");
  assert.doesNotMatch(store, /รอรับเข้าคลัง/, "no task cards on the store view");
  assert.match(store, /<form[^>]*class="rf-search" data-rf-search/);
  const one = await env.open("FACTORY_SR", `tab=stock&q=${encodeURIComponent(stored[0].lotNo)}`);
  assert.equal(h1Of(one), "ในคลัง");
  assert.ok(one.includes(escapeHtml(stored[0].lotNo)));
  assert.ok(!one.includes(escapeHtml(stored[1].lotNo)), "the search narrows the list");
  assert.match(await env.open("FACTORY_SR", "tab=stock&q=ZZZ-NONE"), /ไม่พบเส้นยางที่ค้นหา/);
  // ค้นหาในมุมมองในคลัง = ยังอยู่ในคลัง (พา tab ไปด้วย)
  const form = { handlers: {}, dataset: {}, __values: { q: "  FN-26  " }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  await env.open("FACTORY_SR", "tab=stock");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/sr?tab=stock&q=FN-26", "the search keeps the user on the store view");
});

test("ST: the page opens on งานของฉัน even with no work; the store list is on ในคลัง (its rules: scripts/tests/st-module.test.mjs)", async () => {
  const env = load({ employee: emp("ST") });
  env.store.setUser("B08");
  const data = env.store.data();
  const [high] = data.items.filter((item) => item.kind === "PURCHASED").sort((a, b) => a.code.localeCompare(b.code));
  data.stock = [{ itemCode: high.code, qty: 50, safetyQty: 10 }];
  const link = `href="#/st?part=${encodeURIComponent(high.code)}"`;
  const html = await env.open("FACTORY_ST");
  assert.equal(h1Of(html), "งานของฉัน");
  assert.ok(!html.includes(link), "the store table is not on the work view");
  const store = await env.open("FACTORY_ST", "tab=stock");
  assert.equal(h1Of(store), "ในคลัง");
  assert.ok(store.includes(link), "a part with stock is listed and opens its own page");
});

test("WH: the store view lists the finished goods per code with the orders that hold them; with no work the page still opens on งานของฉัน", async () => {
  const env = load({ employee: emp("WH") });
  env.store.setUser("B09");
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  const fgCode = data.items.find((item) => item.kind === "FG").code;
  data.fgMoves = [{ id: "m1", orderId: order.id, fgCode, kind: "receive", qty: 12, at: 1, by: "x" }, { id: "m2", orderId: order.id, fgCode, kind: "deliver", qty: 2, at: 2, by: "x" }];
  const html = await env.open("FACTORY_WH", "tab=stock");
  assert.equal(h1Of(html), "ในคลัง");
  assert.ok(html.includes(escapeHtml(fgCode)));
  assert.match(html, /10/);
  assert.ok(html.includes(`href="#/wh?order=${escapeHtml(order.id)}"`), "the whole row links to the order page of the warehouse");
  assert.ok(html.includes(`ใบ ${escapeHtml(order.id)}`), "and says whose it is");
  assert.match(await env.open("FACTORY_WH", "tab=stock&q=ZZZ-NONE"), /ไม่พบสินค้าที่ค้นหา/);
  // ไม่มีงานของ WH = ยังเปิดที่งานของฉัน (ข้อความว่าง ไม่ใช่หน้าว่าง และไม่เด้งไปที่ของในคลัง)
  for (const entry of data.orders) entry.status = "draft";
  env.rf.store.data().fgBoxes.length = 0; // and no box from RubberFlow waits for the warehouse
  const idle = await env.open("FACTORY_WH");
  assert.equal(h1Of(idle), "งานของฉัน");
  assert.match(idle, /ไม่มีงานค้าง/);
  assert.ok(!idle.includes(`>${escapeHtml(order.id)}</a>`), "the store table is not shown in place of the work");
  assert.match(await env.open("FACTORY_WH", "tab=work"), /ไม่มีงานค้าง/, "an unknown tab value falls back to the work view");
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
  assert.doesNotMatch(html, /#\/bom\?p=work/, "no link back to a BOM work page");
  // เหมือนการ์ดเดียวกันที่หน้า BOM งานของฉัน ของผู้ใช้คนเดียวกัน · โมดูล GR เพิ่มปุ่มของตัวเอง (ขอเบิกยางเส้นยาว ส่งให้ PK) ที่หน้า BOM ไม่มี
  const work = await workPage(staff);
  const shared = (list) => list.map((buttons) => buttons.filter((name) => !["grRodRequest", "grSendPk"].includes(name)));
  assert.deepEqual(plain(shared(buttonsByCard(html))), plain(buttonsByCard(work.html)), "the dept page offers what BOM work offers for this user, plus the GR buttons");
  // งานที่ตั้งขั้นตอนแล้ว: ไม่มีปุ่มรายงานผลแบบเดิม ปุ่มหลักพาไปบันทึกผลรายวันของงานนั้น
  const planned = data.jobs.find((job) => (data.grPlans ?? []).some((plan) => plan.jobId === job.id));
  const plannedCard = html.split('<article class="card rf-card bom-job').find((card) => card.includes(`job=${planned.id}"`));
  assert.ok(plannedCard.includes(`href="#/gr?tab=log&amp;j=${planned.id}"`));
  assert.doesNotMatch(plannedCard, /jobReport/);
  // ฝ่ายวางแผนเห็นปุ่มปิดงานเพิ่ม เหมือนหน้า BOM
  const planner = load({ employee: emp("PP") });
  planner.store.setUser("B03");
  const plannerHtml = await planner.open("FACTORY_GR");
  assert.match(plannerHtml, /data-rf-open="jobClose"/);
  const plannerWork = await workPage(planner, "p=work&dept=GR");
  assert.deepEqual(plain(shared(buttonsByCard(plannerHtml))), plain(buttonsByCard(plannerWork.html)));
  // ไม่มีงาน: บรรทัดเดียว
  const emptied = load({ employee: emp("GR") });
  emptied.store.data().jobs = [];
  assert.match(await emptied.open("FACTORY_GR"), /ไม่มีงานของ GR ค้างอยู่/);
});

test("the เสร็จแล้ว view lists finished jobs of the department; งานของฉัน leaves them out", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const data = env.store.data();
  const job = data.jobs.find((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done");
  const openBefore = data.jobs.filter((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done").length;
  job.status = "done";
  job.qtyDone = job.qtyPlanned;
  // GR: งานที่เสร็จแต่ยังมีของดีที่ยังไม่ได้ส่ง PK ยังอยู่ในงานของฉัน (ส่งได้อีก) · ส่งครบแล้ว (PK รับ) จึงไปอยู่ที่เสร็จแล้ว
  const sent = env.context.MNP_BOM_RULES.grHandoverSummary(data, job).sent;
  data.grHandovers.push({ id: "test-all-sent", jobId: job.id, orderId: job.orderId, itemCode: job.itemCode, qty: job.qtyDone - sent, status: "received", sentAt: 1 });
  const doneHtml = await env.open("FACTORY_GR", "st=done");
  assert.equal(h1Of(doneHtml), "เสร็จแล้ว");
  assert.ok(doneHtml.includes(escapeHtml(job.name)), "the finished job is on the done view");
  assert.doesNotMatch(doneHtml, /data-rf-open|data-rf-action/, "a finished job has no buttons");
  assert.doesNotMatch(doneHtml, /role="tablist"|class="rf-tab[ "]/, "no in-page tabs");
  // GR: เสร็จแล้วเป็นตัวกรองของงานของฉัน (ลิงก์ในหน้า) ไม่ใช่รายการเมนู
  assert.deepEqual(plain(navOf(env, "FACTORY_GR").items.filter((item) => item.active).map((item) => item.label)), ["งานของฉัน"]);
  assert.match(doneHtml, /href="#\/gr">งานที่ยังไม่เสร็จ<\/a>/);
  const openHtml = await env.open("FACTORY_GR");
  assert.equal(h1Of(openHtml), "งานของฉัน");
  assert.equal([...openHtml.matchAll(/class="card rf-card bom-job/g)].length, openBefore - 1, "the finished job left งานของฉัน");
  assert.deepEqual(plain(navOf(env, "FACTORY_GR").items.filter((item) => item.active).map((item) => item.label)), ["งานของฉัน"]);
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
  // การ์ด "รับจาก GR" (งานที่ GR ส่งให้ PK และยังไม่รับ) อยู่หน้าการ์ดงานผลิต
  const fromGr = (data.grHandovers ?? []).filter((row) => row.status === "sent").length;
  assert.equal([...html.matchAll(/class="card rf-card bom-job/g)].length, open.length + fromGr);
  assert.doesNotMatch(html, /#\/bom\?p=work/);
  assert.equal(h1Of(html), "งานของฉัน");
  assert.match(html, /data-module="pk"/);
  for (const code of ["FACTORY_PT", "FACTORY_BG", "FACTORY_PK"]) assert.doesNotMatch(read(`modules/module-${code.slice(-2).toLowerCase()}.js`), /แท่งยาว/);
});

const ctxCanReport = (job) => job.status !== "hold" && !job.externalRef;
// หน้าแรกของแผนกผูกคำสั่งจริงของ BOM: ปุ่มเปิด dialog, ปุ่มสั่งงาน (resume) ทำงานกับ store แล้ววาดหน้าใหม่ · ถูกปฏิเสธ = แจ้งผิดพลาด ไม่วาดใหม่
test("a department page binds the real BOM actions once: report opens the dialog, resume runs the action and redraws, a refused action toasts and does not redraw", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const data = env.store.data();
  const openJobs = data.jobs.filter((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done" && ctxCanReport(entry) && !(data.grPlans ?? []).some((plan) => plan.jobId === entry.id));
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
  assert.match(bom, /const onOwnRoute = \(\) => onBomRoute\(\) \|\| Boolean\(window\.MNP_FACTORY\?\.onDeptRoute\?\.\(\)\)/);
  assert.match(bom, /store\.subscribe\(\(event\) => \{\r?\n    if \(!onOwnRoute\(\)\) return;/);
});

test("QA's งานของฉัน: the rod lots held at SR are the shared BOM cards, the lots held in the line, the held chemical lots and the open NCRs are cards of the RubberFlow store; nothing links to the RubberFlow quality pages", async () => {
  const env = load({ employee: emp("QA") });
  env.rf.store.setUser("U09");
  assert.doesNotMatch(await env.open("FACTORY_QA"), /ยางเส้นยาวที่กักรอตัดสิน/, "no rod section while no rod lot is held");
  // SR รับล็อตที่ไม่ผ่านขนาด → กักรอ QA
  env.store.setUser("B11");
  const pending = env.store.data().rodLots.find((lot) => lot.status === "pending");
  const outcome = env.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก", location: "Q-01" });
  assert.equal(outcome.ok, true, String(outcome.error?.message ?? ""));
  env.store.setUser("B12");
  const html = await env.open("FACTORY_QA");
  assert.ok(html.includes(escapeHtml(pending.lotNo)), "the held rod lot is listed");
  assert.match(html, /ยางเส้นยาวที่กักรอตัดสิน/);
  assert.match(html, /ล็อตในสายผลิตที่กักรอตัดสิน/);
  assert.match(html, /วัตถุดิบที่กักรอปลดกักกัน/);
  assert.match(html, /NCR ที่ยังเปิดอยู่/);
  const rfHeld = env.rf.store.data().lots.filter((lot) => lot.qc === "hold");
  assert.ok(rfHeld.length >= 1, "the RubberFlow demo seed holds a lot");
  for (const lot of rfHeld) assert.ok(html.includes(escapeHtml(lot.id)), `RubberFlow lot ${lot.id} is listed`);
  for (const lot of env.rf.store.data().materialLots.filter((row) => row.status === "hold")) assert.ok(html.includes(escapeHtml(lot.lotNo)), `held material lot ${lot.lotNo} is listed`);
  for (const ncr of env.rf.store.data().ncrs.filter((row) => row.status === "open")) assert.ok(html.includes(escapeHtml(ncr.id)), `open NCR ${ncr.id} is listed`);
  assert.doesNotMatch(html, /#\/bom\?p=work|#\/rubberflow\?p=(quality|spc|trace)/, "no link back to a BOM work page or the retired RubberFlow pages");
  assert.match(html, /data-rf-scope="rubberflow"/, "the RubberFlow cards are bound by RubberFlow's own binder");
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
    assert.match(html, /รอรับเข้า WH/, `${label} sees the pending receive`);
    assert.ok(html.includes(escapeHtml(order.id)), `${label} sees the order ${order.id}`);
    assert.doesNotMatch(html, /ไม่มีงานค้าง/);
  }
  // the PK cards (the boxes RubberFlow finished for WH are extra cards of the module, with their own buttons)
  const grid = (html) => cardsOf(html).filter((card) => !card.includes("จาก RubberFlow")).join("");
  assert.ok(grid(seen.WH).length > 30 && grid(seen.PP) === grid(seen.WH), "the task card is the same for WH and PP");
  assert.equal(grid(seen.manager), grid(seen.WH), "and for the manager");
});

test("SR shows the store's pending rod receipts to a planner as well, computed for the department, with the buttons a planner has in BOM", async () => {
  const env = load({ employee: emp("PP") });
  env.store.setUser("B03");
  const pending = env.store.data().rodLots.filter((lot) => lot.status === "pending");
  assert.ok(pending.length >= 1);
  const html = await env.open("FACTORY_SR");
  assert.doesNotMatch(html, /ไม่มีงานค้าง/);
  assert.match(html, /รอรับเข้าคลัง/);
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
const decodeArgs = (text) => JSON.parse(text.replaceAll("&quot;", '"'));
const openButtonsOf = (html) => [...html.matchAll(/data-rf-open="(\w+)"(?: data-rf-args="([^"]*)")?/g)].map((match) => ({ name: match[1], handlers: {}, dataset: { rfOpen: match[1], rfArgs: JSON.stringify(decodeArgs(match[2] ?? "{}")) }, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } }));

// เปิดหน้าแผนก ผูกปุ่มของการ์ดที่วาดไว้ และเตรียม dialog จำลองที่รับ HTML ของ dialog ที่เปิด แล้วส่งฟอร์มของ dialog เหมือนผู้ใช้
async function landingWith(env, code, query = "") {
  const buttons = openButtonsOf(await env.open(code, query));
  env.fakes["[data-rf-open]"] = buttons;
  const shown = { html: "", forms: [] };
  const dialog = { tagName: "DIALOG", dataset: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: (selector) => (selector === "form[data-rf-form]" ? shown.forms : []), close() {}, remove() {}, showModal() { this.shown = true; }, setAttribute() {} };
  env.root.insertAdjacentHTML = (_where, text) => {
    shown.html = text;
    shown.forms.length = 0;
    const match = text.match(/data-rf-form="(\w+)"(?: data-rf-args="([^"]*)")?/);
    if (match) shown.forms.push({ handlers: {}, dataset: { rfForm: match[1], rfArgs: JSON.stringify(decodeArgs(match[2] ?? "{}")), rfSuccess: "" }, __values: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, closest: () => null, querySelectorAll: () => [] });
    env.root.lastElementChild = dialog;
  };
  env.context.MNP_RUBBERFLOW_UI.validateForm = () => true; // ตรวจช่องใต้ฟอร์มเป็นของ UI กลาง (ไม่ใช่เรื่องของการทดสอบนี้)
  const html = await env.open(code, query);
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
  assert.doesNotMatch(page.html, /ยางเส้นยาวในคลัง/, "the store table is on ในคลัง, not on งานของฉัน");
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

test("QA: the held rod lot is a card for staff (read-only, says who decides) and has the decide button for the QA head; a head's submit decides the lot", async () => {
  const env = load({ employee: emp("QA") });
  env.rf.store.setUser("U09");
  env.store.setUser("B11");
  const pending = env.store.data().rodLots.find((lot) => lot.status === "pending");
  assert.equal(env.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก", location: "Q-01" }).ok, true);
  env.store.setUser("B12");
  const bom = cardsOf((await workPage(env)).html);
  assert.equal(bom.length, 1, "one held lot waits for QA");
  const staff = await env.open("FACTORY_QA");
  const rodCards = (html) => cardsOf(html).filter((card) => /ตัดสินล็อตยางเส้นยาว/.test(card));
  assert.deepEqual(plain(rodCards(staff)), plain(bom), "the page draws the BOM card as it is");
  assert.doesNotMatch(staff, /data-rf-open="rodDecide"/, "QA staff cannot decide a held rod lot");
  assert.match(staff, /ตัดสินได้เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ/);
  assert.doesNotMatch(staff, /แท่ง/);
  // the QA head (the demo manager account stands for the head: no role code = the manager role)
  env.setEmployee(emp("QA", "department_manager"));
  env.store.setUser("B02");
  const page = await landingWith(env, "FACTORY_QA");
  assert.match(page.html, /data-rf-open="rodDecide"/);
  assert.equal(rodCards(page.html).length, 1);
  const dialog = await page.click("rodDecide");
  assert.match(dialog, /data-rf-form="decideRods"/);
  assert.doesNotMatch(dialog, /แท่ง/);
  await page.submit({ decision: "accept", note: "ใช้ได้ตามสภาพ" });
  assert.equal(env.store.data().rodLots.find((lot) => lot.id === pending.id).status, "stored", "the decision ran against the BOM store");
  assert.doesNotMatch(await env.open("FACTORY_QA"), /ยางเส้นยาวที่กักรอตัดสิน/, "the section leaves with its last card");
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
  // the cards of PK goods are the BOM ones; the boxes RubberFlow finished for WH are extra cards of the module (they are not BOM tasks)
  const own = (html) => cardsOf(html).filter((card) => !card.includes("จาก RubberFlow"));
  assert.deepEqual(plain(own(page.html)), plain(bom));
  assert.doesNotMatch(page.html, /สินค้าสำเร็จรูปในคลัง/, "the store table is on ในคลัง, not on งานของฉัน");
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
  assert.match(issue, /data-rf-open="issueParts"[^>]*>เบิกจ่าย</, "the card opens the issue dialog itself");
  // ST draws its own cards from RubberFlow (requests, returns, purchase orders) and the safety-stock cards; every BOM card is there unchanged
  const stCards = plain(cardsOf(await env.open("FACTORY_ST")));
  for (const card of plain(before)) assert.ok(stCards.includes(card), "the BOM card is the same on the ST page");
  // ใบที่ยกเลิกแล้วที่เบิกของไปแล้ว: การ์ดคืนของเหลือ
  const data = env.store.data();
  const job = data.jobs.find((entry) => entry.dept === "ST" && entry.kind === "PURCHASED");
  data.orders.find((order) => order.id === job.orderId).status = "cancelled";
  job.status = "done";
  job.qtyDone = job.qtyPlanned;
  const bom = cardsOf((await workPage(env)).html);
  assert.ok(bom.some((card) => card.includes("คืนของซื้อที่เบิกไปแล้ว")));
  const page = await landingWith(env, "FACTORY_ST");
  for (const card of plain(bom)) assert.ok(plain(cardsOf(page.html)).includes(card), "the BOM cards are the same");
  assert.doesNotMatch(page.html, /ของซื้อในคลัง/, "the store table is on ในคลัง, not on งานของฉัน");
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
    const source = read(dept === "wh" ? "modules/wh-pages.js" : dept === "st" ? "modules/st-pages.js" : dept === "qa" ? "modules/qa-pages.js" : `modules/module-${dept}.js`);
    assert.match(source, dept === "sr" || dept === "wh" || dept === "qa" ? /F\.deptWork\(ctx/ : /hub\(\)\.boardCards\(ctx, \{ \.\.\.board/, `${dept} places the shared section`);
    assert.match(source, dept === "st" ? /bind: bindPage, actions \}/ : /actions: true/, `${dept} asks for the real actions`);
    // SR draws its own tables (stock, receipts, issues, ledger) with the shared dialog buttons, but never the card markup · WH draws the cards of RubberFlow boxes (not BOM tasks) and never a BOM task card
    // ST draws the cards of RubberFlow documents (requests, returns, purchase orders) and of the safety stock, never a BOM task card
    assert.doesNotMatch(source, dept === "sr" ? /bom-job|taskTable/ : dept === "wh" || dept === "st" || dept === "qa" ? /taskTable|task\.kind|fgReceive|fgDeliver|fgCloseShort|partReturn"\)|kind === "buy"|rodDecide/ : /bom-job|openButton|data-rf-open|taskTable/, `${dept} keeps no copy of the card HTML`);
  }
  assert.doesNotMatch(read("modules/module-st.js"), /bom-job|openButton|data-rf-open|taskTable/, "module-st.js only registers the module");
  assert.doesNotMatch(read("modules/module-qa.js"), /bom-job|openButton|data-rf-open|taskTable|deptWork/, "module-qa.js only registers the module (the pages are in qa-pages.js)");
  assert.doesNotMatch(read("modules/qa-pages.js"), /rubberflow\?p=(quality|spc|trace)|p=quality/, "qa-pages.js has no link to the retired RubberFlow pages");
});

// ---- RubberFlow (แผนก RB): การ์ดงาน RB จาก BOM "งานของฉัน" บนหน้าภาพรวม ----
// ช่องว่างจำลอง: ปุ่มถูกอ่านจาก HTML ที่ใส่เข้าช่องตอนที่ตัวผูกเรียก (ราก RubberFlow ไม่เห็นปุ่มของช่องเลย เหมือนใน DOM จริงที่ช่องยังว่างตอนที่ตัวผูกของหน้า RubberFlow ทำงาน)
function bomSlot() {
  let cache = {};
  let cachedHtml = "";
  const slot = {
    innerHTML: "", removed: false, added: 0,
    remove() { this.removed = true; },
    buttons(kind) {
      if (cachedHtml !== this.innerHTML) { cache = {}; cachedHtml = this.innerHTML; }
      if (cache[kind]) return cache[kind];
      const pattern = kind === "open" ? /data-rf-open="(\w+)" data-rf-args="([^"]*)"/g : /data-rf-action="(\w+)" data-rf-args="([^"]*)"/g;
      cache[kind] = [...this.innerHTML.matchAll(pattern)].map((match) => ({ name: match[1], handlers: {}, dataset: kind === "open" ? { rfOpen: match[1], rfArgs: JSON.stringify(decodeArgs(match[2])) } : { rfAction: match[1], rfArgs: JSON.stringify(decodeArgs(match[2])), rfSuccess: "" }, disabled: false, addEventListener(type, handler) { slot.added += 1; this.handlers[type] = handler; } }));
      return cache[kind];
    },
    querySelectorAll(selector) { return selector === "[data-rf-open]" ? this.buttons("open") : selector === "[data-rf-action]" ? this.buttons("action") : []; },
  };
  return slot;
}
// เปิดหน้าภาพรวมของ RubberFlow ในฐานะ persona หนึ่ง · คืนช่องที่ BOM เติมการ์ดให้
async function rubberflowDashboard({ employee, rfUser = "U01", bomUser, capture = null }) {
  const env = load({ employee, route: "rubberflow", capture });
  env.rf.store.setUser(rfUser);
  env.store.setUser(bomUser);
  const slot = bomSlot();
  env.fakes["[data-bom-jobs]"] = [slot];
  const shown = { html: "" };
  const dialog = { tagName: "DIALOG", dataset: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], close() {}, remove() {}, showModal() { this.shown = true; }, setAttribute() {} };
  env.root.insertAdjacentHTML = (_where, text) => { shown.html = text; env.root.lastElementChild = dialog; };
  env.context.MNP_RUBBERFLOW_UI.validateForm = () => true;
  const html = await env.open("RUBBERFLOW");
  return { env, slot, html, shown, dialog };
}

test("RubberFlow: RB staff see the RB job cards of BOM งานของฉัน on the overview, with exactly the same buttons, bound once", async () => {
  const { env, slot, html } = await rubberflowDashboard({ employee: emp("RB"), bomUser: "B04" });
  const work = await workPage(env);
  const expected = cardsOf(work.html);
  assert.ok(expected.length >= 1, "the demo data has an open RB job");
  assert.match(html, /<div data-bom-jobs><\/div>/, "the page only holds an empty slot; the section is placed after RubberFlow bound its own buttons");
  assert.equal(slot.removed, false);
  assert.equal(env.rf.showsBomJobs(), true, "the page tells module-bom it shows BOM data (repaint path)");
  assert.deepEqual(plain(cardsOf(slot.innerHTML)), plain(expected), "string-identical to the BOM page for the same user");
  assert.match(slot.innerHTML, /งานจากใบสั่งผลิต \(BOM\)/);
  assert.doesNotMatch(slot.innerHTML, /#\/bom\?p=work/, "no link to a BOM work page (งานของฉัน is no longer in BOM)");
  assert.match(slot.innerHTML, /data-rf-open="jobRubberflow"/, "create the RubberFlow WO");
  assert.match(slot.innerHTML, /data-rf-open="jobHold"/);
  assert.doesNotMatch(slot.innerHTML, /data-rf-open="jobClose"/, "staff cannot close a job");
  const buttonCount = [...slot.innerHTML.matchAll(/data-rf-(?:open|action)="/g)].length;
  assert.ok(buttonCount >= 2);
  assert.equal(slot.added, buttonCount, "one listener per button: the kit binder bound the slot exactly once");
  // ราก RubberFlow ไม่เห็นปุ่มของช่อง (ไม่มีคำสั่ง data-rf-action ของ BOM ไปถึง action ของ RubberFlow)
  assert.deepEqual(plain(env.root.querySelectorAll("[data-rf-open]")), []);
  assert.deepEqual(plain(env.root.querySelectorAll("[data-rf-action]")), []);
});

test("RubberFlow: a click on a BOM card opens the real BOM dialog; resume runs the BOM action and redraws; a refused action toasts and does not redraw", async () => {
  const { env, slot, shown } = await rubberflowDashboard({ employee: emp("RB"), bomUser: "B04" });
  const hold = slot.buttons("open").find((button) => button.name === "jobHold");
  assert.ok(hold, "a hold button is offered");
  await hold.handlers.click();
  assert.match(shown.html, /<dialog[^>]*data-rf-dialog/, "the BOM hold dialog opens on the RubberFlow route");
  assert.match(shown.html, /data-rf-form="\w+"/);
  shown.html = "";
  const create = slot.buttons("open").find((button) => button.name === "jobRubberflow");
  assert.ok(create, "creating the RubberFlow WO is offered");
  await create.handlers.click();
  assert.match(shown.html, /<dialog[^>]*data-rf-dialog/, "the create-WO dialog of BOM opens");
  // งานที่พักอยู่: ปุ่มคืนคิว/ทำต่อสั่งงานผ่าน store ของ BOM แล้ววาดหน้า RubberFlow ใหม่
  const job = env.store.data().jobs.find((entry) => entry.dept === "RB" && liveOrder(env.store.data(), entry) && entry.status !== "done" && !entry.externalRef);
  assert.ok(job);
  assert.equal(env.store.run("setJobStatus", { jobId: job.id, status: "hold", reason: "รอวัตถุดิบ" }).ok, true);
  const second = bomSlot();
  env.fakes["[data-bom-jobs]"] = [second];
  await env.open("RUBBERFLOW");
  const resume = second.buttons("action").find((button) => button.name === "setJobStatus");
  assert.ok(resume, "the held job offers resume / back to queue");
  env.log.renders = 0;
  await resume.handlers.click();
  assert.notEqual(env.store.data().jobs.find((entry) => entry.id === job.id).status, "hold", "the action ran against the BOM store");
  assert.equal(resume.disabled, true);
  assert.equal(env.log.renders, 1, "RubberFlow is redrawn after the action");
  // คำสั่งที่ถูกปฏิเสธ: แจ้งผิดพลาด ไม่วาดใหม่ ข้อมูลไม่เปลี่ยน
  const third = bomSlot();
  env.fakes["[data-bom-jobs]"] = [third];
  await env.open("RUBBERFLOW");
  const refused = third.buttons("action")[0] ?? third.buttons("open")[0];
  assert.ok(refused);
  const before = JSON.stringify(env.store.data().jobs);
  env.log.renders = 0;
  const failure = env.store.run("setJobStatus", { jobId: "NO-SUCH-JOB", status: "queued" });
  assert.equal(failure.ok, false, "BOM refuses it");
  assert.equal(JSON.stringify(env.store.data().jobs), before);
  assert.equal(env.log.renders, 0);
});

test("RubberFlow: a planner sees the RB cards with the close button, same as BOM งานของฉัน for RB; other departments see no section", async () => {
  const planner = await rubberflowDashboard({ employee: emp("PP"), rfUser: "U03", bomUser: "B03" });
  const work = await workPage(planner.env, "p=work&dept=RB");
  assert.deepEqual(plain(cardsOf(planner.slot.innerHTML)), plain(cardsOf(work.html)));
  assert.match(planner.slot.innerHTML, /data-rf-open="jobClose"/);
  assert.deepEqual(plain(buttonsByCard(planner.slot.innerHTML)), plain(buttonsByCard(work.html)));
  for (const [dept, userId] of [["GR", "B05"], ["ST", "B08"]]) {
    const other = await rubberflowDashboard({ employee: emp(dept), bomUser: userId });
    assert.equal(other.slot.removed, true, `${dept} has no RB cards in BOM, so none here`);
    assert.equal(other.env.rf.showsBomJobs(), false, `${dept}: the page does not claim BOM data`);
  }
});

test("RubberFlow: outside test mode no section and no placeholder; a loading BOM shows one line; a failed or missing BOM is skipped quietly", async () => {
  const real = load({ employee: emp("RB", "employee", { isSandbox: false }), route: "rubberflow" });
  real.rf.store.setUser("U01");
  real.store.setUser("B04");
  const slot = bomSlot();
  real.fakes["[data-bom-jobs]"] = [slot];
  const html = await real.open("RUBBERFLOW");
  assert.doesNotMatch(html, /data-bom-jobs/, "no placeholder outside test mode");
  assert.equal(slot.innerHTML, "");
  assert.equal(real.rf.showsBomJobs(), false);
  assert.equal(real.context.MNP_FACTORY.mountDeptJobs(bomSlot(), "RB"), false, "the kit refuses outside test mode too");
  const { env } = await rubberflowDashboard({ employee: emp("RB"), bomUser: "B04" });
  const kit = env.context.MNP_FACTORY;
  const bom = env.context.MNP_BOM;
  bom.store.status = () => "loading";
  const waiting = bomSlot();
  assert.equal(kit.mountDeptJobs(waiting, "RB"), true, "loading: the page shows BOM data later, repaint when it arrives");
  assert.match(waiting.innerHTML, /กำลังโหลดงานจากใบสั่งผลิต \(BOM\)/);
  assert.doesNotMatch(waiting.innerHTML, /data-rf-open/);
  bom.store.status = () => "error";
  const failed = bomSlot();
  assert.equal(kit.mountDeptJobs(failed, "RB"), false);
  assert.equal(failed.removed, true);
  assert.equal(kit.mountDeptJobs(null, "RB"), false);
});

test("RubberFlow: a user who is not RB or a planner never makes the BOM store load or repaint the page (decided by role before ensureLoaded)", async () => {
  for (const [dept, userId, loads] of [["ST", "B08", 0], ["GR", "B05", 0], ["RB", "B04", 1], ["PP", "B03", 1]]) {
    const env = load({ employee: emp(dept), route: "rubberflow" });
    env.rf.store.setUser(dept === "PP" ? "U03" : "U01");
    env.store.setUser(userId);
    let calls = 0;
    const ensure = env.store.ensureLoaded;
    env.store.ensureLoaded = (...args) => { calls += 1; return ensure(...args); };
    const slot = bomSlot();
    env.fakes["[data-bom-jobs]"] = [slot];
    await env.open("RUBBERFLOW");
    assert.equal(calls, loads, `${dept}: ensureLoaded calls`);
    assert.equal(slot.removed, loads === 0, `${dept}: the empty slot is removed when there are no cards`);
    assert.equal(env.rf.showsBomJobs(), loads === 1, `${dept}: only a page with BOM data asks to be repainted`);
  }
});

// BOM โหลดอยู่ตอนเปิดหน้า RubberFlow ภาพรวม (ช่องแสดงบรรทัดกำลังโหลด) แล้วผู้ใช้เปิด dialog หรือพิมพ์ค้างระหว่างรอ · store ส่ง loaded / load-failed ครั้งเดียว
async function rubberflowLoading({ editing }) {
  const listeners = [];
  const env = load({ employee: emp("RB"), route: "rubberflow", capture: listeners });
  env.rf.store.setUser("U01");
  env.store.setUser("B04");
  const slot = bomSlot();
  env.fakes["[data-bom-jobs]"] = [slot];
  const ready = env.store.status;
  env.store.status = () => "loading";
  const html = await env.open("RUBBERFLOW");
  assert.match(slot.innerHTML, /กำลังโหลดงานจากใบสั่งผลิต \(BOM\)/, "the slot waits for BOM");
  assert.equal(env.rf.showsBomJobs(), true);
  const before = env.app.innerHTML;
  const document = env.context.document;
  // "กำลังแก้" ของ RubberFlow: dialog ของ RubberFlow เปิดอยู่ หรือฟอร์มที่แก้ค้าง (dirty ผ่าน isEditing ของโมดูล)
  if (editing === "dialog") document.querySelectorAll = (selector) => (selector === "dialog[data-rf-dialog][open]" ? [{}] : []);
  else env.rf.isEditing = () => true;
  env.store.status = ready;
  env.log.renders = 0;
  return { env, slot, listener: listeners[0], before, html };
}

for (const editing of ["dialog", "dirty"]) {
  test(`RubberFlow overview (${editing}): BOM loaded once while RubberFlow is being edited fills only the BOM slot; the page, the dialog and the input stay; buttons bound once`, async () => {
    const { env, slot, listener, before } = await rubberflowLoading({ editing });
    assert.equal(typeof listener, "function", "module-bom subscribed to the BOM store");
    assert.equal(slot.added, 0, "the placeholder has no buttons");
    listener({ type: "loaded" });
    assert.equal(env.log.renders, 0, "the page is not redrawn over the open dialog or the typed input");
    assert.equal(env.app.innerHTML, before, "the RubberFlow page, its dialog and its fields are untouched");
    const work = await workPage(env);
    assert.deepEqual(plain(cardsOf(slot.innerHTML)), plain(cardsOf(work.html)), "the slot now shows the same cards as BOM งานของฉัน");
    assert.match(slot.innerHTML, /งานจากใบสั่งผลิต \(BOM\)/);
    assert.doesNotMatch(slot.innerHTML, /กำลังโหลดงานจากใบสั่งผลิต/);
    const buttonCount = [...slot.innerHTML.matchAll(/data-rf-(?:open|action)="/g)].length;
    assert.ok(buttonCount >= 2);
    assert.equal(slot.added, buttonCount, "one listener per button: bound exactly once");
    assert.equal(slot.removed, false);
    assert.equal(env.rf.showsBomJobs(), true);
    const hold = slot.buttons("open").find((button) => button.name === "jobHold");
    assert.ok(hold, "the card works");
  });

  test(`RubberFlow overview (${editing}): BOM load-failed while RubberFlow is being edited removes the placeholder and leaves the page alone`, async () => {
    const { env, slot, listener, before } = await rubberflowLoading({ editing });
    env.store.status = () => "error";
    listener({ type: "load-failed" });
    assert.equal(slot.removed, true, "the waiting line is gone");
    assert.equal(env.log.renders, 0);
    assert.equal(env.app.innerHTML, before);
    assert.equal(env.rf.showsBomJobs(), false, "the page no longer claims BOM data");
  });
}

test("RubberFlow overview: BOM loaded with nothing being edited still repaints the page, as before; and a BOM page repaints even with a dialog open", async () => {
  const listeners = [];
  const { env } = await rubberflowDashboard({ employee: emp("RB"), bomUser: "B04", capture: listeners });
  const listener = listeners[0];
  env.log.renders = 0;
  listener({ type: "loaded" });
  assert.equal(env.log.renders, 1);
  env.log.hash = "#/bom?p=work";
  env.context.document.querySelectorAll = (selector) => (selector === "dialog[open]" ? [{}] : []);
  env.log.renders = 0;
  listener({ type: "load-failed" });
  assert.equal(env.log.renders, 1, "the BOM route repaints as before");
});

test("department page (#/gr): BOM loaded while a dialog is open does not repaint, and the page repaints when the dialog closes", async () => {
  const listeners = [];
  const env = load({ employee: emp("GR"), route: "gr", capture: listeners });
  env.store.setUser("B05");
  await env.open("FACTORY_GR");
  const document = env.context.document;
  const querySelectorAll = document.querySelectorAll;
  const close = () => (env.log.docListeners.close ?? []).forEach((handler) => handler({ type: "close" }));
  assert.equal(env.log.docListeners.close?.length, 1, "one close watcher, registered once");
  // dialog เปิดอยู่: ไม่วาดทับ
  document.querySelectorAll = (selector) => (selector === "dialog[open]" ? [{}] : []);
  env.log.renders = 0;
  listeners[0]({ type: "loaded" });
  assert.equal(env.log.renders, 0, "no repaint over the open dialog");
  close();
  assert.equal(env.log.renders, 0, "another dialog is still open: keep waiting");
  // dialog ปิดแล้ว: วาดครั้งเดียว
  document.querySelectorAll = querySelectorAll;
  close();
  assert.equal(env.log.renders, 1, "repainted when the dialog closed");
  close();
  assert.equal(env.log.renders, 1, "only once");
  // load-failed ก็เหมือนกัน
  document.querySelectorAll = (selector) => (selector === "dialog[open]" ? [{}] : []);
  listeners[0]({ type: "load-failed" });
  document.querySelectorAll = querySelectorAll;
  close();
  assert.equal(env.log.renders, 2);
  // ไม่มีอะไรค้าง = ปิด dialog เฉยๆ ไม่วาดใหม่
  close();
  assert.equal(env.log.renders, 2);
  // หน้าถูกวาดใหม่เองก่อน dialog ปิด: ไม่วาดซ้ำ
  document.querySelectorAll = (selector) => (selector === "dialog[open]" ? [{}] : []);
  listeners[0]({ type: "loaded" });
  await env.open("FACTORY_GR");
  document.querySelectorAll = querySelectorAll;
  env.log.renders = 0;
  close();
  assert.equal(env.log.renders, 0, "a fresh render of the page cleared the pending repaint");
  // นอกหน้าแผนก: ปิด dialog ไม่วาดอะไร
  document.querySelectorAll = (selector) => (selector === "dialog[open]" ? [{}] : []);
  listeners[0]({ type: "loaded" });
  env.log.hash = "#/requests";
  document.querySelectorAll = querySelectorAll;
  close();
  assert.equal(env.log.renders, 0);
});

test("RubberFlow: module-bom repaints the RubberFlow overview only while it shows BOM data, and no other RubberFlow page; no copy of the card in RubberFlow", () => {
  const bom = read("modules/module-bom.js");
  assert.match(bom, /const onOwnRoute = \(\) => onBomRoute\(\) \|\| Boolean\(window\.MNP_FACTORY\?\.onDeptRoute\?\.\(\)\) \|\| Boolean\(window\.MNP_RUBBERFLOW\?\.showsBomJobs\?\.\(\)\);/);
  const rf = read("modules/module-rubberflow.js");
  assert.match(rf, /showsBomJobs: \(\) => bomJobsShown && onRfRoute\(\)/);
  assert.match(rf, /bomJobsShown = false;\r?\n    app\.innerHTML = shell/, "reset on every render, so another RubberFlow page never counts");
  assert.match(rf, /mountDeptJobs\(bomJobs, "RB"\)/);
  assert.match(rf, /bindPage\(root, ctx\);\r?\n    const bomJobs = root\.querySelector\("\[data-bom-jobs\]"\);/, "the slot is filled after RubberFlow's own binder ran");
  assert.match(read("modules/rubberflow-pages-plan.js"), /ctx\.bomJobsSlot\?\.\(\)/);
  assert.doesNotMatch(rf, /bom-job-|rf-card bom-job|jobCard/);
});

// ---- เมนูข้างของโมดูลแผนก (เจ้าของสั่ง 2026-11-19): ใต้ลิงก์ของโมดูลเหมือน BOM / RubberFlow · "งานของฉัน" อันแรกเสมอ ----
test("side menu: SR (a store) has งานของฉัน with the card count and ในคลัง; the open page is marked; it is empty on any other route", async () => {
  const env = load({ employee: emp("SR") });
  env.store.setUser("B11");
  const html = await env.open("FACTORY_SR");
  const cards = cardsOf(html).length;
  assert.ok(cards >= 4);
  const entry = env.modules.FACTORY_SR;
  const sub = entry.nav[0].subnav("sr");
  assert.match(sub, /^<div class="nav-sub rf-nav" data-module="sr"><ul class="rf-nav-list">/);
  assert.equal([...sub.matchAll(/class="rf-nav-item/g)].length, 5, "งานของฉัน, ในคลัง, รับเข้า, จ่ายให้ GR, ประวัติเข้าออก");
  const { items } = navOf(env, "FACTORY_SR");
  assert.deepEqual(plain(items.slice(0, 2)), [
    { label: "งานของฉัน", href: "#/sr", active: true, current: true, count: cards },
    { label: "ในคลัง", href: "#/sr?tab=stock", active: false, current: false, count: 0 },
  ]);
  assert.match(sub, /<a class="rf-nav-item is-active" href="#\/sr" aria-current="page">/);
  assert.match(sub, new RegExp(`<span class="rf-nav-count" title="งานที่ต้องทำ">${cards}</span>`));
  // เปิดในคลัง: รายการนั้นเป็นหน้าที่เปิดอยู่ (ค้นหาและแสดงเพิ่มก็ยังเป็นในคลัง) ตัวเลขของงานยังอยู่
  await env.open("FACTORY_SR", "tab=stock&q=FN");
  assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.map((item) => [item.label, item.active, item.count])), [["งานของฉัน", false, cards], ["ในคลัง", true, 0], ["รับเข้า", false, 0], ["จ่ายให้ GR", false, 0], ["ประวัติเข้าออก", false, 0]]);
  // หน้าอื่น: ไม่วางเมนู
  assert.equal(entry.nav[0].subnav(""), "");
  assert.equal(entry.nav[0].subnav("requests"), "");
  assert.equal(entry.nav[0].subnav("st"), "");
  // เมนูหลักวางเมนูข้างไว้ใต้ลิงก์ของโมดูลที่เปิดอยู่เท่านั้น
  const nav = env.nav("sr");
  assert.equal([...nav.matchAll(/class="nav-sub rf-nav"/g)].length, 1);
  assert.match(nav, /<div class="nav-group"><a href="#\/sr">คลังยางเส้นยาว \(SR\)<\/a><div class="nav-sub rf-nav" data-module="sr">/);
  assert.doesNotMatch(env.nav("requests"), /nav-sub/);
  // ไม่มีงานค้าง = ไม่มีตัวเลข · BOM ยังไม่พร้อม หรือไม่ใช่โหมดทดสอบ = ไม่มีตัวเลขแต่ยังมีรายการ
  env.store.status = () => "loading";
  await env.open("FACTORY_SR");
  assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.map((item) => [item.label, item.count])), [["งานของฉัน", 0], ["ในคลัง", 0], ["รับเข้า", 0], ["จ่ายให้ GR", 0], ["ประวัติเข้าออก", 0]], "BOM not ready: no count");
});

test("side menu: ST has งานของฉัน, ในคลัง, ใบสั่งซื้อ, จ่ายออก, รับคืน and นับสต็อก; WH has งานของฉัน, ในคลัง, รับเข้า, ส่งมอบ and ประวัติ, with the lot and order pages under ในคลัง", async () => {
  const env = load({ employee: emp("ST") });
  env.store.setUser("B08");
  await env.open("FACTORY_ST");
  assert.deepEqual(plain(navOf(env, "FACTORY_ST").items.map((item) => [item.label, item.href, item.active])), [["งานของฉัน", "#/st", true], ["ในคลัง", "#/st?tab=stock", false], ["ใบสั่งซื้อ", "#/st?tab=po", false], ["จ่ายออก", "#/st?tab=issue", false], ["รับคืน", "#/st?tab=returns", false], ["นับสต็อก", "#/st?tab=count", false]]);
  const wh = load({ employee: emp("WH") });
  wh.store.setUser("B09");
  await wh.open("FACTORY_WH");
  const items = () => plain(navOf(wh, "FACTORY_WH").items.map((item) => [item.label, item.href, item.active]));
  assert.deepEqual(items(), [["งานของฉัน", "#/wh", true], ["ในคลัง", "#/wh?tab=stock", false], ["รับเข้า", "#/wh?tab=receive", false], ["ส่งมอบ", "#/wh?tab=deliver", false], ["ประวัติ", "#/wh?tab=history", false]]);
  for (const [query, active] of [["tab=receive", "รับเข้า"], ["tab=deliver", "ส่งมอบ"], ["tab=history", "ประวัติ"], ["tab=stock", "ในคลัง"], ["order=DEMO-26001", "ในคลัง"], ["lot=FN-X", "ในคลัง"]]) {
    await wh.open("FACTORY_WH", query);
    assert.deepEqual(items().filter((item) => item[2]).map((item) => item[0]), [active], query);
  }
});

test("side menu: GR (production) has งานของฉัน with the open-job count and its own pages (settings only for a head); PT, BG and PK have งานของฉัน and เสร็จแล้ว", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const data = env.store.data();
  const open = data.jobs.filter((job) => job.dept === "GR" && liveOrder(data, job) && job.status !== "done").length;
  assert.ok(open >= 1);
  await env.open("FACTORY_GR");
  assert.deepEqual(plain(navOf(env, "FACTORY_GR").items), [
    { label: "งานของฉัน", href: "#/gr", active: true, current: true, count: open },
    { label: "บันทึกผลรายวัน", href: "#/gr?tab=log", active: false, current: false, count: 0 },
    { label: "ยางเส้นยาว", href: "#/gr?tab=rods", active: false, current: false, count: 0 },
    { label: "ส่งให้ PK", href: "#/gr?tab=pk", active: false, current: false, count: 0 },
    { label: "สรุปผล", href: "#/gr?tab=summary", active: false, current: false, count: 0 },
  ], "GR staff: no settings item");
  await env.open("FACTORY_GR", "st=done");
  assert.deepEqual(plain(navOf(env, "FACTORY_GR").items.map((item) => [item.label, item.active, item.count])).slice(0, 2), [["งานของฉัน", true, open], ["บันทึกผลรายวัน", false, 0]], "done view is a filter of งานของฉัน: the open-job count stays");
  env.store.setUser("B03");
  assert.equal(navOf(env, "FACTORY_GR").items.at(-1).label, "ตั้งค่าขั้นตอนและเป้า", "the planner sees settings");
  env.store.setUser("B05");
  assert.equal(env.modules.FACTORY_GR.nav[0].subnav("bom"), "");
  for (const [code, route, userId, dept] of [["FACTORY_PT", "pt", "B06", "PT"], ["FACTORY_BG", "bg", "B07", "BG"], ["FACTORY_PK", "pk", "B03", "PP"]]) {
    const other = load({ employee: emp(dept) });
    other.store.setUser(userId);
    await other.open(code);
    assert.deepEqual(plain(navOf(other, code).items.map((item) => [item.label, item.href])), [["งานของฉัน", `#/${route}`], ["เสร็จแล้ว", `#/${route}?st=done`]], code);
  }
  // ไม่มีงานเปิดเลย: ไม่มีตัวเลข
  env.store.data().jobs = [];
  await env.open("FACTORY_GR");
  assert.equal(navOf(env, "FACTORY_GR").items[0].count, 0);
});

test("side menu: QA has งานของฉัน (counted by its cards), ผลตรวจ, NCR, CoA, SPC, สืบย้อนกลับ and วัตถุดิบที่กัก; each opens its page", async () => {
  const env = load({ employee: emp("QA") });
  env.rf.store.setUser("U09");
  env.store.setUser("B11");
  const pending = env.store.data().rodLots.find((lot) => lot.status === "pending");
  assert.equal(env.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก", location: "Q-01" }).ok, true);
  env.store.setUser("B12");
  const html = await env.open("FACTORY_QA");
  assert.equal(h1Of(html), "งานของฉัน");
  const cards = cardsOf(html).length;
  assert.ok(cards >= 4, "a rod lot, a line lot, a chemical lot and an NCR");
  const items = plain(navOf(env, "FACTORY_QA").items);
  assert.deepEqual(items.map((item) => [item.label, item.href]), [["งานของฉัน", "#/qa"], ["ผลตรวจ", "#/qa?tab=records"], ["NCR", "#/qa?tab=ncr"], ["CoA", "#/qa?tab=coa"], ["SPC", "#/qa?tab=spc"], ["สืบย้อนกลับ", "#/qa?tab=trace"], ["วัตถุดิบที่กัก", "#/qa?tab=material"]]);
  assert.deepEqual(items.map((item) => item.active), [true, false, false, false, false, false, false]);
  assert.equal(items[0].count, cards, "the number on the menu = the cards of the page");
  assert.deepEqual(items.slice(1).map((item) => item.count), [0, 0, 0, 0, 0, 0], "no other item repeats a number");
  assert.equal(env.modules.FACTORY_QA.nav[0].subnav("sr"), "");
  for (const [tab, label] of [["records", "ผลตรวจ"], ["ncr", "NCR"], ["coa", "CoA"], ["spc", "SPC"], ["trace", "สืบย้อนกลับ"], ["material", "วัตถุดิบที่กัก"]]) {
    const page = await env.open("FACTORY_QA", `tab=${tab}`);
    assert.equal(h1Of(page), label, tab);
    assert.equal(navOf(env, "FACTORY_QA").items.find((item) => item.active)?.label, label, `${tab} is the marked page`);
    assert.doesNotMatch(page, /undefined|NaN|\[object Object\]|แท่ง/, tab);
  }
  // ตัดสินแล้ว (หัวหน้า) ตัวเลขลดลง
  env.setEmployee(emp("QA", "department_manager"));
  env.store.setUser("B02");
  assert.equal(env.store.run("decideRods", { lotId: pending.id, decision: "accept", note: "ใช้ได้ตามสภาพ" }).ok, true);
  await env.open("FACTORY_QA");
  assert.equal(navOf(env, "FACTORY_QA").items[0].count, cards - 1);
});

test("side menu: viewOf and the menu definitions; nothing outside test mode", () => {
  const { STORE_MENU, viewHead } = load().context.MNP_FACTORY;
  assert.deepEqual(plain(STORE_MENU.map((item) => [item.id, item.label, item.params])), [["work", "งานของฉัน", {}], ["stock", "ในคลัง", { tab: "stock" }]]);
  assert.ok(Object.isFrozen(STORE_MENU));
  assert.match(viewHead({ factory: {}, view: { label: "ในคลัง" }, ui: {} }), /<h1>ในคลัง<\/h1>/);
  assert.match(viewHead({ factory: {} }), /<h1>งานของฉัน<\/h1>/, "no view = งานของฉัน");
  const env = load({ employee: emp("SR", "employee", { isSandbox: false }) });
  assert.equal(env.modules.FACTORY_SR.navAllowed(env.context.state.employee), false);
});

// ---- โมดูล SR (ขั้น 1 ของโรงงาน): เมนูข้าง 5 รายการ · ในคลัง · รับเข้า · จ่ายให้ GR · ประวัติเข้าออก · หน้าล็อต · ป้ายพร้อม QR ----
// ล็อตสาธิต (modules/bom-seed.js addRodDemo): L0 สต็อกกลาง 6 เส้นที่ A-01 · L1 ของใบ DEMO-26006 20 เส้นที่ A-02 · L4 รับนอกใบสั่ง 15 เส้นที่ B-01 · L2 L3 รอรับ
const srEnv = (employee = emp("SR"), userId = "B11") => { const env = load({ employee }); env.store.setUser(userId); return env; };
const rodLotOf = (env, no) => env.store.data().rodLots.find((lot) => lot.id === `5e1d0000-0000-4000-8000-${String(no).padStart(12, "0")}`);
const lotLinks = (html) => [...html.matchAll(/href="#\/sr\?lot=([^"&]+)"/g)].map((match) => match[1]);
const storedBuckets = (env) => env.context.MNP_BOM_RULES.rodBuckets(env.store.data()).filter((bucket) => bucket.lot.status === "stored");
const SR_TABS = [["stock", "ในคลัง"], ["receive", "รับเข้า"], ["issue", "จ่ายให้ GR"], ["history", "ประวัติเข้าออก"]];

test("SR: the side menu has five items in order, งานของฉัน stays the default, and a lot or its label belongs to ในคลัง", async () => {
  const env = srEnv();
  const html = await env.open("FACTORY_SR");
  assert.equal(h1Of(html), "งานของฉัน", "the default view is the work cards");
  const { items } = navOf(env, "FACTORY_SR");
  assert.deepEqual(plain(items.map((item) => [item.label, item.href, item.active])), [
    ["งานของฉัน", "#/sr", true], ["ในคลัง", "#/sr?tab=stock", false], ["รับเข้า", "#/sr?tab=receive", false], ["จ่ายให้ GR", "#/sr?tab=issue", false], ["ประวัติเข้าออก", "#/sr?tab=history", false],
  ]);
  assert.ok(items[0].count >= 4, "the count stays on งานของฉัน only");
  assert.deepEqual(plain(items.slice(1).map((item) => item.count)), [0, 0, 0, 0]);
  for (const [tab, label] of SR_TABS) {
    assert.equal(h1Of(await env.open("FACTORY_SR", `tab=${tab}`)), label, `${tab} is titled ${label}`);
    assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.filter((item) => item.active).map((item) => item.label)), [label]);
  }
  const lot = rodLotOf(env, 1);
  await env.open("FACTORY_SR", `lot=${lot.id}`);
  assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.filter((item) => item.active).map((item) => item.label)), ["ในคลัง"], "a lot page sits under ในคลัง");
  await env.open("FACTORY_SR", `lot=${lot.id}&print=1`);
  assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.filter((item) => item.active).map((item) => item.label)), ["ในคลัง"], "so does its label");
  assert.equal(h1Of(await env.open("FACTORY_SR", "tab=nothing")), "งานของฉัน", "an unknown tab falls back to the work cards");
  // ไม่มีงานค้างก็ยังเปิดที่ งานของฉัน และไม่มีปุ่มรับนอกใบสั่งบนหน้านั้น (ปุ่มอยู่ที่ ในคลัง และ รับเข้า)
  assert.doesNotMatch(html, /data-rf-open="rodOpening"/);
});

test("SR ในคลัง: only lots in the store with stock left, with code, name, compound, colour, size, quantity, lot, received date, location and owner", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const stock = await env.open("FACTORY_SR", "tab=stock");
  for (const heading of ["เส้นยาง", "จำนวน", "ล็อต", "ตำแหน่ง", "ของ"]) assert.match(stock, new RegExp(`>${heading}</th>`), `column ${heading}`);
  const data = env.store.data();
  const buckets = storedBuckets(env);
  assert.equal(new Set(buckets.map((bucket) => bucket.lot.lotNo)).size, 3, "L0, L1 and the opening lot are in the store");
  for (const bucket of buckets) {
    const { lot } = bucket;
    const attrs = rules.rodAttrs(data.items, bucket.itemCode, data.colors);
    assert.ok(attrs.text, "the demo codes carry compound, colour and size");
    for (const text of [lot.lotNo, lot.location, bucket.itemCode, attrs.name, attrs.text, rules.fmtDate(lot.receivedAt)]) assert.ok(stock.includes(escapeHtml(text)), `${lot.lotNo} shows ${text}`);
    assert.ok(stock.includes(`href="#/sr?lot=${lot.id}"`), `${lot.lotNo} opens its lot page`);
  }
  assert.match(stock, /สต็อกกลาง/);
  assert.match(stock, /href="#\/bom\?p=orders&amp;sel=DEMO-26006"/, "an order's rods link to the order");
  // ล็อตที่รอรับ และล็อตที่กัก ไม่ใช่ของในคลัง
  for (const no of [2, 3]) assert.ok(!stock.includes(escapeHtml(rodLotOf(env, no).lotNo)), "a pending lot is not stock");
  // ล็อตที่ยอดเหลือ 0 ไม่แสดง (ไม่แสดงทั้งทะเบียน): ปรับยอดสต็อกกลางของ L0 ลงเป็นศูนย์
  assert.equal(env.store.run("adjustRods", { lotId: rodLotOf(env, 0).id, qty: -6, note: "นับจริงไม่พบ" }).ok, true, "SR adjusts");
  const after = await env.open("FACTORY_SR", "tab=stock");
  assert.ok(!after.includes(escapeHtml(rodLotOf(env, 0).lotNo)), "a lot with no stock left drops off the list");
  assert.ok(after.includes(escapeHtml(rodLotOf(env, 1).lotNo)));
  // ล็อตที่กักรอ QA ก็ไม่ใช่ของในคลัง
  const l2 = rodLotOf(env, 2);
  assert.equal(env.store.run("receiveRods", { lotId: l2.id, qtyReceived: l2.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก", location: "H-01" }).ok, true);
  assert.equal(rodLotOf(env, 2).status, "held");
  assert.ok(!(await env.open("FACTORY_SR", "tab=stock")).includes(escapeHtml(l2.lotNo)), "a held lot is not stock");
});

test("SR ในคลัง: search covers code, name, lot, location, compound and colour; the owner and location filters narrow it; filters stay on search and paging", async () => {
  const env = srEnv();
  const data = env.store.data();
  const rules = env.context.MNP_BOM_RULES;
  const [l0, l1, l4] = [0, 1, 4].map((no) => rodLotOf(env, no));
  const shows = async (query) => lotLinks(await env.open("FACTORY_SR", `tab=stock&${query}`)).sort();
  const only = (...lots) => lots.map((lot) => lot.id).sort();
  const attrs1 = rules.rodAttrs(data.items, l1.itemCode, data.colors);
  assert.deepEqual(await shows(`q=${encodeURIComponent(l1.lotNo)}`), only(l1), "lot number");
  assert.deepEqual(await shows("q=B-01"), only(l4), "location");
  assert.deepEqual(await shows("q=a-02"), only(l1), "location, any case");
  assert.deepEqual(await shows(`q=${encodeURIComponent(l4.itemCode)}`).then((ids) => ids.includes(l4.id)), true, "code");
  assert.ok((await shows(`q=${encodeURIComponent(attrs1.name)}`)).includes(l1.id), "name");
  assert.ok((await shows(`q=${encodeURIComponent(attrs1.compound)}`)).includes(l1.id), "compound");
  assert.ok((await shows(`q=${encodeURIComponent(attrs1.colorName)}`)).includes(l1.id), "colour name");
  assert.ok((await shows(`q=${encodeURIComponent(attrs1.color)}`)).includes(l1.id), "colour code");
  assert.match(await env.open("FACTORY_SR", "tab=stock&q=ZZZ-NONE"), /ไม่พบเส้นยางที่ค้นหา/);
  // ตัวกรองเจ้าของ: สต็อกกลาง / ของใบสั่ง
  assert.deepEqual(await shows("own=free"), only(l0, l4), "free stock");
  assert.deepEqual(await shows("own=order"), only(l1), "rods held for an order");
  // ตัวกรองตำแหน่ง
  assert.deepEqual(await shows("loc=A-01"), only(l0));
  assert.deepEqual(await shows("own=free&loc=B-01"), only(l4), "filters combine");
  assert.deepEqual(await shows("own=order&loc=B-01"), [], "and can leave nothing");
  assert.deepEqual(await shows("loc=-"), [], "no stored lot lacks a location in the demo");
  const page = await env.open("FACTORY_SR", "tab=stock");
  for (const place of ["A-01", "A-02", "B-01"]) assert.match(page, new RegExp(`<option value="${place}"`), `the location list offers ${place}`);
  assert.match(page, /<option value="free">สต็อกกลาง<\/option>/);
  assert.match(page, /<option value="order">ของใบสั่ง<\/option>/);
  assert.match(await env.open("FACTORY_SR", "tab=stock&loc=A-02"), /<option value="A-02" selected>/, "the chosen location stays selected");
  assert.match(await env.open("FACTORY_SR", "tab=stock&own=free"), /ล้างตัวกรอง/);
  assert.doesNotMatch(page, /ล้างตัวกรอง/, "nothing to clear with no filter");
  // ตัวกรองไปกับการค้นหา และการเปลี่ยนตัวกรองพา tab / ค้นหาที่ตั้งไว้ไปด้วย
  const form = { handlers: {}, dataset: {}, __values: { q: " A-0 " }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const select = { handlers: {}, dataset: {}, name: "loc", value: "A-02", addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  env.fakes["[data-sr-filter]"] = [select];
  await env.open("FACTORY_SR", "tab=stock&own=free");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/sr?tab=stock&q=A-0&own=free", "search keeps the owner filter");
  select.handlers.change();
  assert.equal(env.log.hash, "#/sr?tab=stock&own=free&loc=A-02", "a changed filter keeps the others");
  select.value = "";
  select.handlers.change();
  assert.equal(env.log.hash, "#/sr?tab=stock&own=free", "clearing a filter drops it");
  // ทะเบียนใหญ่: แสดงทีละ 100 แถวพร้อมแสดงเพิ่มที่ยังอยู่ในตัวกรองเดิม
  const rows = env.store.data();
  for (let n = 0; n < 130; n += 1) {
    const id = `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    rows.rodLots.push({ ...l4, id, lotNo: `BULK-${String(n).padStart(3, "0")}` });
    rows.rodMoves.push({ id: `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`, lotId: id, itemCode: l4.itemCode, kind: "receive", qty: 1, ownerOrderId: null, at: 1, by: "x", note: "", reversesId: null, forOrderId: null });
  }
  const big = await env.open("FACTORY_SR", "tab=stock&own=free");
  assert.equal(lotLinks(big).length, 100, "100 rows at a time");
  assert.match(big, /แสดงเพิ่ม \(อีก 32\)/);
  assert.match(big, /href="#\/sr\?tab=stock&amp;own=free&amp;n=200"/, "more keeps the filter");
  assert.equal(lotLinks(await env.open("FACTORY_SR", "tab=stock&own=free&n=200")).length, 132);
});

test("SR: the opening receipt button is on ในคลัง and รับเข้า for SR and a planner, never for others; its dialog takes the rods in as free stock", async () => {
  for (const [employee, userId, shown] of [[emp("SR"), "B11", true], [emp("PP"), "B03", true], [emp("PP", "factory_manager"), "B08", false]]) {
    const env = srEnv(employee, userId);
    for (const tab of ["stock", "receive"]) assert.equal(/data-rf-open="rodOpening"/.test(await env.open("FACTORY_SR", `tab=${tab}`)), shown, `${employee.department.code} on ${tab}`);
    for (const tab of ["issue", "history"]) assert.doesNotMatch(await env.open("FACTORY_SR", `tab=${tab}`), /rodOpening/, `not on ${tab}`);
  }
  const env = srEnv();
  const page = await landingWith(env, "FACTORY_SR", "tab=stock");
  const dialog = await page.click("rodOpening");
  assert.match(dialog, /data-rf-form="receiveRodsOpening"/);
  assert.match(dialog, /รับยางเส้นยาวนอกใบสั่ง/);
  for (const field of ["itemCode", "lotNo", "qty", "location", "note"]) assert.match(dialog, new RegExp(`name="${field}"`), field);
  assert.match(dialog, /RB-DM02-02-BK01-225-3-20 · /, "the code list is the RB items");
  assert.doesNotMatch(dialog, /value="(SE|PT|CP)-/, "only rods (RB) are offered");
  assert.equal((dialog.match(/field-required/g) ?? []).length >= 5, true, "every field is marked required");
  const before = env.store.data().rodLots.length;
  await page.submit({ itemCode: "RB-DM02-02-BK01-225-3-20", lotNo: "op-ui-1", qty: "4", location: "C-03", note: "ซื้อเข้ามาเพิ่ม" });
  const lots = env.store.data().rodLots;
  assert.equal(lots.length, before + 1);
  const made = lots.find((lot) => lot.lotNo === "OP-UI-1");
  assert.deepEqual(plain([made.source, made.status, made.location, made.sourceNote, made.orderId]), ["opening", "stored", "C-03", "ซื้อเข้ามาเพิ่ม", null]);
  const stock = await env.open("FACTORY_SR", "tab=stock");
  assert.ok(stock.includes("OP-UI-1") && stock.includes("C-03"), "the new lot is on the stock list at once");
  // ข้อมูลไม่ถูกต้อง = ปฏิเสธ (ไม่มีตำแหน่ง · เลขล็อตซ้ำ · ไม่ใช่เส้นยาง)
  for (const bad of [{ location: "" }, { lotNo: "OP-UI-1" }, { itemCode: "PT-00320" }]) {
    const result = env.store.run("receiveRodsOpening", { itemCode: "RB-DM02-02-BK01-225-3-20", lotNo: "OP-UI-2", qty: 1, location: "C-04", note: "ทดสอบ", ...bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
});

test("SR รับเข้า: lots waiting from RB with the receive dialog, lots held for QA read-only, recent receipts with where they came from", async () => {
  const env = srEnv();
  const [l2, l3] = [2, 3].map((no) => rodLotOf(env, no));
  let html = await env.open("FACTORY_SR", "tab=receive");
  assert.equal([...html.matchAll(/data-rf-open="rodReceive"/g)].length, 2, "one receive button per pending lot");
  for (const lot of [l2, l3]) assert.ok(html.includes(escapeHtml(lot.lotNo)));
  assert.match(html, /รอรับเข้าคลัง/);
  assert.match(html, /รับเข้าล่าสุด/);
  assert.match(html, /รับนอกใบสั่ง · B-01/, "a recent receipt says where it came from and where it was put");
  assert.match(html, /\+15/, "the opening receipt of 15 rods");
  // รับ L3 แล้วไม่ผ่าน: กักรอ QA อ่านอย่างเดียว ไม่มีปุ่มรับ
  assert.equal(env.store.run("receiveRods", { lotId: l3.id, qtyReceived: l3.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ผิวเป็นคลื่น", location: "H-02" }).ok, true);
  html = await env.open("FACTORY_SR", "tab=receive");
  assert.equal([...html.matchAll(/data-rf-open="rodReceive"/g)].length, 1);
  assert.match(html, /กักรอ QA ตัดสิน/);
  assert.ok(html.includes("ผิวเป็นคลื่น") && html.includes("H-02"), "the held lot shows the SR's note and its location");
  assert.doesNotMatch(html.slice(html.indexOf("กักรอ QA ตัดสิน")), /data-rf-open="rodDecide"/, "deciding is QA's, not here");
  // ผู้ที่ไม่ใช่ SR / ฝ่ายวางแผน: ดูได้แต่ไม่มีปุ่มรับ
  const viewer = srEnv(emp("PP", "factory_manager"), "B08");
  assert.doesNotMatch(await viewer.open("FACTORY_SR", "tab=receive"), /data-rf-open="rod/);
  // dialog รับเข้าเป็นของเดิม (วัดขนาด + ตำแหน่ง): เปิดจากปุ่มในตาราง
  const page = await landingWith(srEnv(), "FACTORY_SR", "tab=receive");
  const dialog = await page.click("rodReceive");
  assert.match(dialog, /data-rf-form="receiveRods"/);
  assert.match(dialog, /name="location"/);
});

test("SR จ่ายให้ GR: orders waiting for rods with the issue dialog, recent issues with reverse; a reversed issue shows no second reverse", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const need = rules.rodIssueNeeds(env.store.data()).find((row) => row.order.id === "DEMO-26006");
  let html = await env.open("FACTORY_SR", "tab=issue");
  assert.ok(html.includes("DEMO-26006"));
  assert.match(html, new RegExp(`data-rf-open="rodIssue" data-rf-args="[^"]*${need.itemCode}`), "the issue button carries the order and the rod code");
  assert.match(html, /ยังไม่เคยจ่ายให้ GR/);
  const page = await landingWith(env, "FACTORY_SR", "tab=issue");
  assert.match(await page.click("rodIssue"), /data-rf-form="issueRods"/);
  assert.equal(env.store.run("issueRods", { orderId: "DEMO-26006", itemCode: need.itemCode, qty: 2 }).ok, true);
  html = await env.open("FACTORY_SR", "tab=issue");
  const reverse = [...html.matchAll(/data-rf-open="rodReverse" data-rf-args="([^"]*)"/g)];
  assert.equal(reverse.length, 1, "the issue can be reversed");
  assert.match(html, /จ่ายให้ GR/);
  const moveId = decodeArgs(reverse[0][1]).moveId;
  assert.equal(env.store.run("reverseRodIssue", { moveId, note: "จ่ายผิดใบ" }).ok, true);
  html = await env.open("FACTORY_SR", "tab=issue");
  assert.doesNotMatch(html, /data-rf-open="rodReverse"/, "reversed once, no second button");
  assert.match(html, /ถูกย้อน/);
  const viewer = srEnv(emp("PP", "factory_manager"), "B08");
  assert.doesNotMatch(await viewer.open("FACTORY_SR", "tab=issue"), /data-rf-open="rod/, "no buttons without the right");
});

// ---- SR: คลิกที่ไหนของการ์ด/แถวก็เปิดหน้ารายละเอียดของรายการนั้น (เจ้าของโรงงานสั่ง 2026-11-19) ----
const RB_DEMO = "RB-DM02-02-YE03-204-19-34";
const cardOf = (cards, name) => cards.filter((card) => card.includes(`data-rf-open="${name}"`));

test("SR cards open the item's detail page from anywhere on the card; the button keeps its own action; cards without a detail page stay plain", async () => {
  const env = srEnv();
  const cards = cardsOf((await workPage(env)).html);
  const receive = cardOf(cards, "rodReceive");
  const issue = cardOf(cards, "rodIssue");
  assert.equal(receive.length, 2, "two lots wait for receiving");
  for (const card of receive) {
    const lotId = decodeArgs(card.match(/data-rf-args="([^"]*)"/)[1]).lotId;
    assert.match(card, /^<article class="card rf-card bom-job is-now has-link">/, "the card is marked clickable");
    assert.ok(card.includes(`<h2><a class="bom-card-link" href="#/sr?lot=${lotId}">รับยางเส้นยาวเข้าคลัง ล็อต `), "the title is the one real link, to the lot page");
    assert.equal([...card.matchAll(/class="bom-card-link"/g)].length, 1, "one link per card");
    assert.ok(card.includes('data-rf-open="rodReceive"'), "the card's own button is still there");
    assert.doesNotMatch(card, /<a class="bom-card-link"[^>]*>[^<]*<button/, "the button is not inside the card link");
    assert.match(card, /ส่งมาจาก RB/, "it says the lot came from RB");
    assert.equal([...card.matchAll(/ส่งมา/g)].length, 1, "and says so once");
  }
  assert.ok(issue.length >= 1);
  const forOrder = issue.find((card) => card.includes("ตามใบ DEMO-26006"));
  assert.ok(forOrder.includes(`href="#/sr?issue=DEMO-26006&amp;code=${RB_DEMO}"`), "an issue card opens the issue detail page of its order and rod");
  assert.match(forOrder, /<h2><a class="bom-card-link" href="[^"]*">จ่ายยางเส้นยาวให้ GR ตามใบ DEMO-26006<\/a><\/h2>/);
  assert.ok(forOrder.includes('data-rf-open="rodIssue"'));
  // การ์ดที่ไม่มีหน้ารายละเอียด (ตัดสินของ QA) ไม่เป็นลิงก์ · ผู้ที่เปิดโมดูล SR ไม่ได้ก็ไม่ได้ลิงก์
  const qa = load({ employee: emp("QA") });
  qa.store.setUser("B11");
  const pending = qa.store.data().rodLots.find((lot) => lot.status === "pending");
  assert.equal(qa.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก", location: "Q-01" }).ok, true);
  qa.store.setUser("B12");
  const held = cardsOf((await workPage(qa)).html);
  assert.equal(held.length, 1);
  assert.doesNotMatch(held[0], /bom-card-link|has-link/);
  env.setEmployee(emp("GR"));
  const noAccess = cardsOf((await workPage(env)).html).filter((card) => card.includes('data-rf-open="rod'));
  assert.ok(noAccess.length >= 4);
  for (const card of noAccess) assert.doesNotMatch(card, /bom-card-link|has-link/, "no link to a page the user cannot open");
});

test("the shared job card takes a detail URL (text or function) and is a plain card without one", async () => {
  const env = srEnv();
  const kit = env.context.MNP_FACTORY;
  const ctx = env.context.MNP_BOM.context(new URLSearchParams());
  const job = env.store.data().jobs.find((entry) => entry.dept === "GR");
  const plainCard = kit.jobCard(ctx, job, { planner: false, dept: "GR" });
  assert.doesNotMatch(plainCard, /bom-card-link|has-link/, "other modules' cards are unchanged");
  const linked = kit.jobCard(ctx, job, { planner: false, dept: "GR", href: (entry) => `#/gr?job=${entry.id}` });
  assert.match(linked, /^<article class="card rf-card bom-job[^"]* has-link">/);
  assert.ok(linked.includes(`<h2><a class="bom-card-link" href="#/gr?job=${job.id}">${escapeHtml(job.name)}</a></h2>`));
  assert.match(kit.jobCard(ctx, job, { planner: false, dept: "GR", href: "#/x?a=1&b=2" }), /href="#\/x\?a=1&amp;b=2"/, "the URL is escaped");
  assert.equal(kit.cardTitle("a<b", null), "a&lt;b");
  assert.equal(kit.cardClass(null), "");
  // ลิงก์คลุมการ์ดด้วย CSS ส่วนปุ่มและลิงก์อื่นในการ์ดอยู่เหนือชั้น (กดปุ่มไม่เปิดหน้ารายละเอียดซ้อน) · แถวตารางทำแบบเดียวกันและมือถือไม่บังกรอบอ้างอิง
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.bom-card-link::after \{ content: ""; position: absolute; inset: 0;/);
  assert.match(css, /\.bom-job\.has-link :is\(a:not\(\.bom-card-link\), button, input, select, textarea\) \{ position: relative; z-index: 1; \}/);
  assert.match(css, /\.bom-job\.has-link \{ position: relative; cursor: pointer;/);
  assert.match(css, /tr\.row-link \{ position: relative; transform: translate\(0\); cursor: pointer; \}/);
  assert.match(css, /\.row-link-main::after \{ content: ""; position: absolute; inset: 0; z-index: 1; \}/, "the row cover sits above the mobile card cells (position: relative) so every cell opens the lot");
  assert.match(css, /tr\.row-link :is\(a:not\(\.row-link-main\), button, input, select, textarea\) \{ position: relative; z-index: 2; \}/, "links and buttons in the row stay above the cover");
  assert.match(css, /\.row-link-main:focus-visible::after \{ outline:/, "a keyboard focus ring shows on the row");
  assert.match(css, /max-width: 760px\) \{\s*\.rf-page \.rf-table tr\.row-link td:has\(\.row-link-main\) \{ position: static;/, "on a phone the cell holding the link does not hide the row from the link");
});

test("SR lot page of a pending lot: it says RB sent it and has the receive button that opens the same dialog; a viewer has no button", async () => {
  const env = srEnv();
  const l2 = rodLotOf(env, 2);
  assert.equal(l2.status, "pending");
  const html = await env.open("FACTORY_SR", `lot=${l2.id}`);
  assert.equal(h1Of(html), `ล็อต ${l2.lotNo}`);
  assert.match(html, /data-rf-open="rodReceive" data-rf-args="[^"]*"[^>]*>รับเข้าคลัง</);
  assert.match(html, /ส่งมาจาก RB · งาน /);
  assert.match(html, /<a class="request-back-link" href="#\/sr\?tab=receive">‹ รับเข้า<\/a>/, "back to the list the lot came from");
  assert.doesNotMatch(html, /data-rf-open="rod(Location|Adjust)"/);
  const page = await landingWith(env, "FACTORY_SR", `lot=${l2.id}`);
  const dialog = await page.click("rodReceive");
  assert.match(dialog, /data-rf-form="receiveRods"/);
  assert.match(dialog, new RegExp(`รับยางเส้นยาวเข้าคลัง · ล็อต ${l2.lotNo}`));
  // รับแล้ว: หน้าเดิมไม่มีปุ่มรับอีก
  assert.equal(env.store.run("receiveRods", { lotId: l2.id, qtyReceived: l2.qtySent, values: { thickness: 7.5, width: 34.1, weightPerM: 1205 }, location: "A-03" }).ok, true);
  assert.doesNotMatch(await env.open("FACTORY_SR", `lot=${l2.id}`), /data-rf-open="rodReceive"/);
  const viewer = srEnv(emp("PP", "factory_manager"), "B08");
  assert.doesNotMatch(await viewer.open("FACTORY_SR", `lot=${rodLotOf(viewer, 3).id}`), /data-rf-open="rodReceive"/);
});

test("SR issue detail page: order link, customer, due, rubber, need / issued / still to issue, lots to pick oldest first with their shelf, past issues with reverse", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.id === "DEMO-26006");
  const attrs = rules.rodAttrs(data.items, RB_DEMO, data.colors);
  const query = `issue=DEMO-26006&code=${RB_DEMO}`;
  let html = await env.open("FACTORY_SR", query);
  assert.equal(h1Of(html), "จ่ายยางเส้นยาวให้ GR");
  assert.match(html, /<a class="request-back-link" href="#\/sr\?tab=issue">‹ จ่ายให้ GR<\/a>/);
  assert.deepEqual(plain(navOf(env, "FACTORY_SR").items.filter((item) => item.active).map((item) => item.label)), ["จ่ายให้ GR"], "the page sits under จ่ายให้ GR");
  assert.match(html, /<a class="rf-mono" href="#\/bom\?p=orders&amp;sel=DEMO-26006">DEMO-26006<\/a>/, "the order is a link");
  for (const text of [order.customer, RB_DEMO, attrs.name, attrs.compound, attrs.size]) assert.ok(html.includes(escapeHtml(text)), `shows ${text}`);
  assert.match(html, /กำหนด<\/dt><dd><span/, "the due date");
  assert.match(html, /GR ต้องใช้<\/dt><dd>36 เส้น<\/dd>/);
  assert.match(html, /จ่ายแล้ว<\/dt><dd>0 เส้น<\/dd>/);
  assert.match(html, /ยังต้องจ่าย<\/dt><dd><strong>36 เส้น<\/strong><\/dd>/);
  // ที่ต้องหยิบ: ของใบนี้ก่อน (ล็อต A-02 20 เส้น) แล้วสต็อกกลาง (A-01 6 เส้น) ขาด 10 · ตำแหน่งทุกแถว
  const picks = html.match(/<li class="sr-pick-row">[\s\S]*?<\/li>/g) ?? [];
  assert.equal(picks.length, 2, "only the lots that are needed");
  assert.match(picks[0], /sr-pick-mark">หยิบ<[\s\S]*sr-pick-loc" title="ตำแหน่งจัดเก็บ">A-02<[\s\S]*ของใบ DEMO-26006[\s\S]*sr-pick-qty nowrap">20 เส้น/);
  assert.match(picks[1], /sr-pick-loc" title="ตำแหน่งจัดเก็บ">A-01<[\s\S]*สต็อกกลาง[\s\S]*sr-pick-qty nowrap">6 เส้น/);
  assert.match(html, /ในคลังมีไม่พอ ขาด 10 เส้น/);
  assert.ok(!html.includes(escapeHtml(rodLotOf(env, 4).lotNo)), "a lot of another rod is not listed");
  assert.match(html, /ยังไม่เคยจ่ายให้ใบนี้/);
  assert.match(html, new RegExp(`data-rf-open="rodIssue" data-rf-args="[^"]*DEMO-26006[^"]*${RB_DEMO}`), "the button opens the issue dialog");
  const page = await landingWith(env, "FACTORY_SR", query);
  assert.match(await page.click("rodIssue"), /data-rf-form="issueRods"/);
  // จ่ายแล้ว 2 เส้น: ตัวเลขและรายการหยิบเปลี่ยน ประวัติมีแถวจ่าย ย้อนได้ครั้งเดียว
  assert.equal(env.store.run("issueRods", { orderId: "DEMO-26006", itemCode: RB_DEMO, qty: 2 }).ok, true);
  html = await env.open("FACTORY_SR", query);
  assert.match(html, /จ่ายแล้ว<\/dt><dd>2 เส้น<\/dd>/);
  assert.match(html, /ยังต้องจ่าย<\/dt><dd><strong>34 เส้น<\/strong>/);
  assert.match(html.match(/<li class="sr-pick-row">[\s\S]*?<\/li>/)[0], /A-02[\s\S]*18 เส้น/, "the oldest lot now has 18 left");
  const reverse = [...html.matchAll(/data-rf-open="rodReverse" data-rf-args="([^"]*)"/g)];
  assert.equal(reverse.length, 1);
  assert.match(html, /จ่ายให้ GR/);
  assert.doesNotMatch(html.slice(html.indexOf("จ่ายไปแล้ว")), /ใบ DEMO-26006 ·/, "the order is not repeated on each row of its own page");
  assert.equal(env.store.run("reverseRodIssue", { moveId: decodeArgs(reverse[0][1]).moveId, note: "จ่ายผิดใบ" }).ok, true);
  html = await env.open("FACTORY_SR", query);
  assert.doesNotMatch(html, /data-rf-open="rodReverse"/);
  assert.match(html, /ถูกย้อน/);
  // ไม่พบใบ / ไม่มีสิทธิ์จ่าย
  assert.match(await env.open("FACTORY_SR", `issue=NOPE&code=${RB_DEMO}`), /ไม่พบใบสั่งผลิตหรือเส้นยางนี้/);
  const viewer = srEnv(emp("PP", "factory_manager"), "B08");
  const seen = await viewer.open("FACTORY_SR", query);
  assert.match(seen, /ยังต้องจ่าย/);
  assert.doesNotMatch(seen, /data-rf-open="rod/);
  // ใบที่ไม่มีงานจ่ายค้าง (ใบที่ปิดแล้ว): บอกเหตุผล ประวัติยังดูได้
  assert.match(await env.open("FACTORY_SR", `issue=DEMO-26008&code=${RB_DEMO}`), /ไม่มีงานจ่ายยางเส้นยาวค้างอยู่/);
});

test("SR tables: a row is one stretched link to its detail page, other links and buttons in the row stay; GR's read view has no row links", async () => {
  const env = srEnv();
  const rowsOf = (html) => html.match(/<tr class="row-link[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  // ในคลัง: แถวละล็อตเปิดหน้าล็อต · ลิงก์ใบสั่งผลิตในแถวยังเป็นลิงก์ของมันเอง
  const stock = await env.open("FACTORY_SR", "tab=stock");
  const rows = rowsOf(stock);
  assert.equal(rows.length, storedBuckets(env).length);
  for (const row of rows) {
    assert.equal([...row.matchAll(/row-link-main/g)].length, 1, "one main link per row");
    assert.match(row, /<a class="rf-mono row-link-main" href="#\/sr\?lot=[^"]+">/);
  }
  const owned = rows.find((row) => row.includes("sel=DEMO-26006"));
  assert.match(owned, /<a class="rf-mono" href="#\/bom\?p=orders&amp;sel=DEMO-26006">/, "the order link is not the row link");
  assert.equal(lotLinks(stock).length, rows.length, "no lot link outside a row");
  // รับเข้า: ล็อตที่รอรับ ล็อตที่กัก รับเข้าล่าสุด · ปุ่มรับเข้าในแถวยังกดได้
  const l3 = rodLotOf(env, 3);
  assert.equal(env.store.run("receiveRods", { lotId: l3.id, qtyReceived: l3.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ผิวเป็นคลื่น", location: "H-02" }).ok, true);
  const receive = rowsOf(await env.open("FACTORY_SR", "tab=receive"));
  assert.equal(receive.filter((row) => row.includes('data-rf-open="rodReceive"')).length, 1);
  assert.ok(receive.length >= 3, "waiting, held and the receipts");
  for (const row of receive) assert.match(row, new RegExp(`<a class="rf-mono row-link-main" href="#/sr\\?lot=[^"]+">`));
  // จ่ายให้ GR: ใบที่รอ = หน้ารายละเอียดการจ่าย (รหัสเส้นยางเป็นลิงก์หลัก) · จ่ายล่าสุด = หน้าเดียวกัน
  const issueHref = `href="#/sr?issue=DEMO-26006&amp;code=${RB_DEMO}"`;
  let issue = rowsOf(await env.open("FACTORY_SR", "tab=issue"));
  const need = issue.find((row) => row.includes(issueHref));
  assert.ok(need.includes(`<a class="rf-mono row-link-main" ${issueHref}>`));
  assert.match(need, /<a class="rf-mono" href="#\/bom\?p=orders&amp;sel=DEMO-26006">/, "the order link in the row still goes to the order");
  assert.ok(need.includes('data-rf-open="rodIssue"'));
  assert.equal(env.store.run("issueRods", { orderId: "DEMO-26006", itemCode: RB_DEMO, qty: 2 }).ok, true);
  issue = rowsOf(await env.open("FACTORY_SR", "tab=issue"));
  const recent = issue.find((row) => row.includes('data-rf-open="rodReverse"'));
  assert.ok(recent.includes(`<a class="row-link-main" ${issueHref}>จ่ายให้ GR</a>`), "a past issue opens the issue page of its order");
  // ประวัติเข้าออกและหน้ารายละเอียดเองไม่เป็นแถวลิงก์
  assert.equal(rowsOf(await env.open("FACTORY_SR", "tab=history")).length, 0);
  assert.equal(rowsOf(await env.open("FACTORY_SR", `issue=DEMO-26006&code=${RB_DEMO}`)).length, 0);
  // GR อ่านอย่างเดียว: ตารางคลัง SR ในหน้า ยางเส้นยาว ของ GR ไม่มีลิงก์ (GR เปิด #/sr ไม่ได้) และไม่มีแถวคลิกได้ (แถวของตารางงานข้างบนเปิดหน้างานของ GR เอง)
  const gr = load({ employee: emp("GR") });
  gr.store.setUser("B05");
  const readOnly = (await gr.open("FACTORY_GR", "tab=rods")).split("ยางเส้นยาวในคลัง SR</h2>")[1];
  assert.ok(readOnly.includes("rf-table"));
  assert.doesNotMatch(readOnly, /row-link|#\/sr\?/);
});

test("SR ประวัติเข้าออก: the ledger newest first, search by code, lot and order, a kind filter, reverse only on unreversed issues", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const need = rules.rodIssueNeeds(env.store.data()).find((row) => row.order.id === "DEMO-26006");
  assert.equal(env.store.run("issueRods", { orderId: "DEMO-26006", itemCode: need.itemCode, qty: 3 }).ok, true);
  assert.equal(env.store.run("adjustRods", { lotId: rodLotOf(env, 4).id, qty: -1, note: "ชำรุด" }).ok, true);
  const html = await env.open("FACTORY_SR", "tab=history");
  const times = [...html.matchAll(/<td class="nowrap small">([^<]*)<\/td>/g)].map((match) => match[1]);
  const moves = env.store.data().rodMoves.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id)));
  assert.deepEqual(times, moves.map((move) => rules.fmtDateTime(move.at)), "newest first");
  for (const label of ["รับเข้าคลัง", "จ่ายให้ GR", "ปรับยอด"]) assert.ok(html.includes(label), label);
  assert.equal([...html.matchAll(/data-rf-open="rodReverse"/g)].length, 1, "one unreversed issue");
  assert.equal([...(await env.open("FACTORY_SR", "tab=history&kind=issue")).matchAll(/<td class="nowrap small">/g)].length, 1, "kind filter");
  assert.equal([...(await env.open("FACTORY_SR", "tab=history&kind=receive")).matchAll(/<td class="nowrap small">/g)].length, 3, "three receipts in the demo");
  assert.match(await env.open("FACTORY_SR", "tab=history&kind=issue"), /<option value="issue" selected>/);
  assert.equal([...(await env.open("FACTORY_SR", "tab=history&q=DEMO-26006")).matchAll(/<td class="nowrap small">/g)].length >= 2, true, "by order");
  assert.equal([...(await env.open("FACTORY_SR", `tab=history&q=${encodeURIComponent(rodLotOf(env, 4).lotNo)}`)).matchAll(/<td class="nowrap small">/g)].length, 2, "by lot (receipt and adjustment)");
  assert.equal([...(await env.open("FACTORY_SR", `tab=history&q=${encodeURIComponent(need.itemCode)}`)).matchAll(/<td class="nowrap small">/g)].length >= 2, true, "by code");
  assert.match(await env.open("FACTORY_SR", "tab=history&q=ZZZ-NONE"), /ไม่พบรายการที่ค้นหา/);
  assert.match(await env.open("FACTORY_SR", "tab=history&kind=issue&q=ZZZ"), /ล้างตัวกรอง/);
  // ตัวกรองชนิดพาไปกับการค้นหา
  const form = { handlers: {}, dataset: {}, __values: { q: "DEMO" }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  await env.open("FACTORY_SR", "tab=history&kind=issue");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/sr?tab=history&q=DEMO&kind=issue");
});

test("SR lot page: identity once, source, location, QC result, buckets and move history; actions follow the right; an opening lot says where it came from", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const data = env.store.data();
  const l1 = rodLotOf(env, 1);
  const attrs = rules.rodAttrs(data.items, l1.itemCode, data.colors);
  const html = await env.open("FACTORY_SR", `lot=${l1.id}`);
  assert.equal(h1Of(html), `ล็อต ${l1.lotNo}`);
  assert.match(html, /<a class="request-back-link" href="#\/sr\?tab=stock">‹ ในคลัง<\/a>/, "a back link, lifted into the top bar by the shell");
  for (const text of [l1.itemCode, attrs.name, attrs.compound, attrs.color, attrs.colorName, attrs.size, "อยู่ในคลัง", "A-02", l1.orderId, "ส่งมาจาก RB"]) assert.ok(html.includes(escapeHtml(text)), `shows ${text}`);
  assert.equal([...html.matchAll(new RegExp(escapeHtml(l1.lotNo), "g"))].length, 1, "the lot number appears once, in the heading");
  assert.match(html, /ผลตรวจขนาดตอนรับเข้า/);
  assert.match(html, /ความหนา/);
  assert.match(html, /ผ่าน/);
  assert.match(html, /ของใบ DEMO-26006 20/, "the bucket left");
  assert.match(html, /ประวัติเข้าออกของล็อต/);
  assert.match(html, /\+20/);
  for (const name of ["rodLocation", "rodAdjust"]) assert.match(html, new RegExp(`data-rf-open="${name}" data-rf-args="[^"]*${l1.id}`), name);
  assert.match(html, new RegExp(`href="#/sr\\?lot=${l1.id}&amp;print=1"[^>]*>พิมพ์ป้าย`));
  // ย้ายตำแหน่ง: dialog แล้วส่งฟอร์ม
  const page = await landingWith(env, "FACTORY_SR", `lot=${l1.id}`);
  const dialog = await page.click("rodLocation");
  assert.match(dialog, /data-rf-form="setRodLocation"/);
  assert.match(dialog, /value="A-02"/, "the current location is filled in");
  await page.submit({ location: "Z-09" });
  assert.equal(rodLotOf(env, 1).location, "Z-09");
  assert.match(await env.open("FACTORY_SR", `lot=${l1.id}`), /Z-09/);
  // ล็อตที่รับนอกใบสั่ง: ที่มา + หมายเหตุ ไม่มีลิงก์ใบสั่ง ไม่มีส่วนผลตรวจ
  const l4 = rodLotOf(env, 4);
  const opening = await env.open("FACTORY_SR", `lot=${l4.id}`);
  assert.ok(opening.includes(escapeHtml(`${rules.ROD_SOURCE_LABEL.opening} · ${l4.sourceNote}`)));
  assert.doesNotMatch(opening, /ผลตรวจขนาดตอนรับเข้า|ใบสั่งผลิต<\/dt>/);
  assert.doesNotMatch(opening, /sel=DEMO/, "no order behind it");
  // ไม่มีสิทธิ์: ดูได้และพิมพ์ป้ายได้ แต่ไม่มีปุ่มย้ายตำแหน่ง / ปรับยอด
  const viewer = srEnv(emp("PP", "factory_manager"), "B08");
  const read = await viewer.open("FACTORY_SR", `lot=${l1.id}`);
  assert.doesNotMatch(read, /data-rf-open="rod/);
  assert.match(read, /พิมพ์ป้าย/);
  // แต่ละข้อมูลแสดงครั้งเดียว: ล็อตที่มีแถวรับเข้าในประวัติไม่มีแถว "รับเข้า" ซ้ำในรายการข้อมูล · ล็อตรับนอกใบสั่งไม่ซ้ำหมายเหตุที่มาในแถวรับเข้า
  assert.doesNotMatch(html, /<dt[^>]*>รับเข้า<\/dt>/, "the receive facts are in the history");
  assert.equal([...opening.matchAll(new RegExp(escapeHtml(l4.sourceNote), "g"))].length, 1, "the source note once, in the source row");
  // ล็อตที่รับแล้วแต่ยังรอ QA ไม่มีแถวรับเข้าในประวัติ: รายการข้อมูลยังบอกจำนวน ผู้รับ เวลา
  const lot3 = env.store.data().rodLots.find((lot) => lot.id === rodLotOf(env, 3).id);
  Object.assign(lot3, { status: "held", qtyReceived: 8, receivedBy: "SR-ผู้ทดสอบ", receivedAt: lot3.createdAt });
  assert.match(await env.open("FACTORY_SR", `lot=${lot3.id}`), /<dt[^>]*>รับเข้า<\/dt>[\s\S]*SR-ผู้ทดสอบ/);
  lot3.status = "pending";
  // ปรับยอดต้องเป็นล็อตที่อยู่ในคลัง · ล็อตที่รอรับไม่มีปุ่มย้ายตำแหน่ง/ปรับยอด
  const pending = await env.open("FACTORY_SR", `lot=${rodLotOf(env, 2).id}`);
  assert.doesNotMatch(pending, /data-rf-open="rod(Location|Adjust)"/);
  assert.match(pending, /รอรับเข้าคลัง/);
  // ไม่พบล็อต
  assert.match(await env.open("FACTORY_SR", "lot=no-such-lot"), /ไม่พบล็อตนี้/);
  assert.match(await env.open("FACTORY_SR", "lot=no-such-lot&print=1"), /ไม่พบล็อตนี้/);
});

test("SR label: printable only for a lot that is held or in the store; other statuses get no button and a short message; owner and quantity are the current balance", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const l1 = rodLotOf(env, 1);
  const buttonOf = (html, lot) => html.includes(`lot=${lot.id}&amp;print=1`);
  for (const status of ["pending", "returned", "scrapped"]) {
    const lot = rodLotOf(env, 2);
    lot.status = status;
    assert.ok(!buttonOf(await env.open("FACTORY_SR", `lot=${lot.id}`), lot), `${status}: no print button`);
    const view = await env.open("FACTORY_SR", `lot=${lot.id}&print=1`);
    assert.doesNotMatch(view, /<article class="sr-label"|data-sr-print/, `${status}: no label`);
    assert.match(view, /พิมพ์ป้ายได้เฉพาะล็อตที่รอ QA ตัดสินหรืออยู่ในคลัง/);
  }
  for (const status of ["held", "stored"]) {
    const lot = rodLotOf(env, 2);
    lot.status = status;
    assert.ok(buttonOf(await env.open("FACTORY_SR", `lot=${lot.id}`), lot), `${status}: print button`);
    assert.match(await env.open("FACTORY_SR", `lot=${lot.id}&print=1`), /<article class="sr-label"/, `${status}: label`);
  }
  rodLotOf(env, 2).status = "pending";
  // เหลือในคลัง: ป้ายบอกยอดคงเหลือ ไม่ใช่ยอดที่รับ · ล็อตเดียวหลายเจ้าของ = ยอดของแต่ละเจ้าของ
  assert.equal(env.store.run("adjustRods", { lotId: rodLotOf(env, 0).id, qty: -2, note: "นับจริงไม่พบ" }).ok, true);
  const adjusted = await env.open("FACTORY_SR", `lot=${rodLotOf(env, 0).id}&print=1`);
  assert.match(adjusted, /<dt>คงเหลือ<\/dt><dd>4 /, "the balance, not the 6 received");
  assert.doesNotMatch(adjusted, /จำนวนรับ/);
  env.store.data().rodMoves.push({ id: "5e1d0000-0000-4000-8000-000000000999", lotId: l1.id, itemCode: l1.itemCode, kind: "adjust", qty: 5, ownerOrderId: null, forOrderId: null, reversesId: null, note: "", at: Date.now(), by: "SR" });
  const unit = rules.uomLabel(l1.uom);
  const shared = await env.open("FACTORY_SR", `lot=${l1.id}&print=1`);
  assert.ok(shared.includes(`<dt>ของ</dt><dd>ของใบ DEMO-26006 20 ${unit} · สต็อกกลาง 5 ${unit}</dd>`), "every owner with stock");
  assert.match(shared, new RegExp(`<dt>คงเหลือ</dt><dd>25 ${unit}</dd>`));
});

test("SR label: one printable label per lot with code, name, compound, colour, size, lot, quantity, date, location, owner and a QR of the absolute lot URL; print shows only the label", async () => {
  const env = srEnv();
  const rules = env.context.MNP_BOM_RULES;
  const data = env.store.data();
  Object.defineProperty(env.context.location, "origin", { value: "https://mnp.example", configurable: true });
  Object.defineProperty(env.context.location, "pathname", { value: "/pilot/", configurable: true });
  const encoded = [];
  const real = env.context.qrcode;
  assert.equal(typeof real, "function", "the vendored encoder is loaded");
  env.context.qrcode = (type, level) => { const qr = real(type, level); const add = qr.addData; qr.addData = (text) => { encoded.push(text); return add(text); }; return qr; };
  for (const [no, owner] of [[0, "สต็อกกลาง"], [1, "ใบ DEMO-26006"], [4, "สต็อกกลาง"]]) {
    const lot = rodLotOf(env, no);
    const attrs = rules.rodAttrs(data.items, lot.itemCode, data.colors);
    encoded.length = 0;
    const html = await env.open("FACTORY_SR", `lot=${lot.id}&print=1`);
    assert.equal(h1Of(html), `ป้ายล็อต ${lot.lotNo}`);
    assert.match(html, /<article class="sr-label"/);
    for (const text of [lot.itemCode, attrs.name, attrs.compound, attrs.color, attrs.colorName, attrs.size, lot.lotNo, `${rules.fmtQty(lot.qtyReceived)} ${rules.uomLabel(lot.uom)}`, rules.fmtDate(lot.receivedAt), lot.location, owner]) assert.ok(html.includes(escapeHtml(text)), `label shows ${text}`);
    assert.deepEqual(plain(encoded), [`https://mnp.example/pilot/#/sr?lot=${lot.id}`], "the QR encodes the absolute URL of the lot page");
    assert.match(html, /<div class="sr-label-qr"><svg [^>]*viewBox=/, "the QR is drawn as inline SVG");
    assert.match(html, /<button class="btn rf-btn" type="button" data-sr-print>พิมพ์ป้าย<\/button>/);
    assert.match(html, /<div class="rf-row no-print">/, "the buttons are hidden when printing");
    assert.match(html, new RegExp(`<a class="request-back-link" href="#/sr\\?lot=${lot.id}">‹ ล็อต `));
  }
  // ปุ่มพิมพ์เรียกพิมพ์ของเบราว์เซอร์
  let printed = 0;
  env.context.print = () => { printed += 1; };
  const button = { handlers: {}, dataset: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-sr-print]"] = [button];
  await env.open("FACTORY_SR", `lot=${rodLotOf(env, 0).id}&print=1`);
  button.handlers.click();
  assert.equal(printed, 1);
  // ไม่มีตัวเข้ารหัส QR: ป้ายยังพิมพ์ได้ และมีที่อยู่เป็นข้อความแทน
  env.context.qrcode = undefined;
  assert.match(await env.open("FACTORY_SR", `lot=${rodLotOf(env, 0).id}&print=1`), /<div class="sr-label-qr"><span class="small">https:\/\/mnp\.example\/pilot\/#\/sr\?lot=/);
  // ป้ายของผู้ที่ไม่มีสิทธิ์ทำรายการก็พิมพ์ได้ (ไม่เปลี่ยนข้อมูล)
  assert.match(await srEnv(emp("PP", "factory_manager"), "B08").open("FACTORY_SR", `lot=${rodLotOf(env, 0).id}&print=1`), /<article class="sr-label"/);
  // CSS: พิมพ์แล้วเห็นแต่ป้าย (แถบข้าง แถบบน ปุ่ม ซ่อน)
  const css = read("styles.css");
  assert.match(css, /@media print \{\s*body:has\(\.sr-label\) :is\(\.sidebar, \.topbar[^)]*\.no-print[^)]*\) \{ display: none !important; \}/);
  assert.match(css, /\.sr-label \{ width: 100mm; box-shadow: none; break-inside: avoid;/);
  assert.match(read("vendor/qrcode-generator/qrcode.js"), /Licensed under the MIT license/);
  assert.match(read("vendor/qrcode-generator/LICENSE"), /MIT License/);
});

test("SR: who can open the module, its lots and labels: SR staff and planners in test mode; GR, ID, office, other departments and anyone outside test mode get not found", async () => {
  const allowed = [[emp("SR"), "B11"], [emp("PP"), "B03"], [emp("PP", "admin"), "B03"], [emp("MT", "factory_manager"), "B03"]];
  for (const [employee, userId] of allowed) {
    const env = srEnv(employee, userId);
    const lot = rodLotOf(env, 1);
    for (const query of ["", "tab=stock", "tab=receive", "tab=issue", "tab=history", `lot=${lot.id}`, `lot=${lot.id}&print=1`]) {
      env.log.notFound = 0;
      assert.match(await env.open("FACTORY_SR", query), /<shell path="sr"/, `${employee.department.code}/${employee.role.code} opens ${query || "home"}`);
      assert.equal(env.log.notFound, 0);
    }
  }
  const denied = [emp("GR"), emp("QA"), emp("ST"), emp("WH"), emp("RB"), emp("ID"), emp("ID", "admin"), emp("HR"), emp("OF"), emp("MT", "department_manager"), emp("SR", "employee", { isSandbox: false }), emp("PP", "admin", { isSandbox: false })];
  for (const employee of denied) {
    const env = srEnv(emp("SR"), "B11");
    const lot = rodLotOf(env, 1);
    env.setEmployee(employee);
    for (const query of ["", "tab=stock", "tab=history", `lot=${lot.id}`, `lot=${lot.id}&print=1`]) {
      env.log.notFound = 0;
      await env.open("FACTORY_SR", query);
      assert.equal(env.log.notFound, 1, `${employee.department.code}/${employee.role.code}${employee.isSandbox === false ? " outside test mode" : ""} gets not found on ${query || "home"}`);
    }
  }
  // และการสั่งงานตัดสินที่ฐานข้อมูล/action: GR ปรับยอดหรือรับนอกใบสั่งไม่ได้
  const gr = srEnv(emp("GR"), "B05");
  assert.equal(gr.store.run("receiveRodsOpening", { itemCode: "RB-DM02-02-BK01-225-3-20", lotNo: "OP-GR", qty: 1, location: "X-1", note: "ทดสอบ" }).ok, false);
  assert.equal(gr.store.run("adjustRods", { lotId: rodLotOf(gr, 4).id, qty: -1, note: "ทดสอบ" }).ok, false);
  assert.equal(gr.store.run("setRodLocation", { lotId: rodLotOf(gr, 4).id, location: "X-2" }).ok, false);
});

test("GR ยางเส้นยาว: the SR stock table read-only inside #/gr, with the filters; no lot links, no actions, no way into the SR module", async () => {
  const env = srEnv(emp("GR"), "B05");
  const page = await env.open("FACTORY_GR", "tab=rods");
  assert.equal(h1Of(page), "ยางเส้นยาว");
  assert.deepEqual(plain(navOf(env, "FACTORY_GR").items.filter((item) => item.active).map((item) => [item.label, item.href])), [["ยางเส้นยาว", "#/gr?tab=rods"]]);
  // ตารางคลัง SR อยู่ใต้หัวข้อของตัวเอง (ตารางงาน คำขอเบิก และประวัติคำขออยู่ข้างบน · ดู gr-module.test.mjs)
  const html = page.split("ยางเส้นยาวในคลัง SR</h2>")[1];
  for (const bucket of storedBuckets(env)) for (const text of [bucket.lot.lotNo, bucket.lot.location, bucket.itemCode]) assert.ok(html.includes(escapeHtml(text)), `shows ${text}`);
  for (const heading of ["เส้นยาง", "จำนวน", "ล็อต", "ตำแหน่ง", "ของ"]) assert.match(html, new RegExp(`>${heading}</th>`));
  assert.doesNotMatch(html, /data-rf-open|data-rf-action|<form[^>]*data-rf-form|href="#\/sr|รับยางนอกใบสั่ง|rodLocation/, "read-only");
  assert.doesNotMatch(html, /แท่ง/);
  assert.equal(lotLinks(html).length, 0, "no lot page for GR");
  // ตัวกรองและค้นหาทำงานภายใน GR
  const owned = (await env.open("FACTORY_GR", "tab=rods&own=order")).split("ยางเส้นยาวในคลัง SR</h2>")[1];
  const lotNo = (no) => escapeHtml(rodLotOf(env, no).lotNo);
  assert.ok(owned.includes(lotNo(1)) && !owned.includes(lotNo(0)) && !owned.includes(lotNo(4)), "the owner filter works inside GR");
  assert.match(await env.open("FACTORY_GR", "tab=rods&q=ZZZ-NONE"), /ไม่พบเส้นยางที่ค้นหา/);
  const form = { handlers: {}, dataset: {}, __values: { q: "A-0" }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const select = { handlers: {}, dataset: {}, name: "own", value: "free", addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  env.fakes["[data-sr-filter]"] = [select];
  await env.open("FACTORY_GR", "tab=rods&loc=A-01");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/gr?tab=rods&q=A-0&loc=A-01", "search stays in GR");
  select.handlers.change();
  assert.equal(env.log.hash, "#/gr?tab=rods&own=free&loc=A-01", "a filter stays in GR");
  // งานของฉัน ของ GR ไม่เปลี่ยน
  assert.equal(h1Of(await env.open("FACTORY_GR")), "งานของฉัน");
  // QA ไม่มีลิงก์ไปหน้าคลังแล้ว
  const qa = srEnv(emp("QA"), "B12");
  assert.doesNotMatch(await qa.open("FACTORY_QA"), /p=rods|#\/sr/);
  // GR ที่เปิดมุมมองนี้ผ่านลิงก์เก่าก็ไม่เจอหน้าว่าง · ฝ่ายอื่นไม่เห็น
  const st = srEnv(emp("ST"), "B08");
  assert.doesNotMatch(await st.open("FACTORY_ST"), /p=rods|ยางเส้นยาวในคลัง SR/);
});

test("the SR and GR files keep to ยางเส้นยาว wording, keep no copy of the card HTML and load the QR encoder before the module", () => {
  for (const file of ["modules/module-sr.js", "modules/module-gr.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /แท่ง/, `${file} says ยางเส้นยาว`);
    assert.doesNotMatch(source, /bom-job/, `${file} keeps no card markup`);
  }
  const html = read("index.html");
  const order = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  assert.ok(order.indexOf("vendor/qrcode-generator/qrcode.js") >= 0 && order.indexOf("vendor/qrcode-generator/qrcode.js") < order.indexOf("modules/module-sr.js"));
  assert.match(html, /script-src 'self'/, "the encoder is same-origin: the CSP allows it");
  assert.match(read("scripts/pilot-harness.mjs"), /\(\?:modules\|vendor\)/, "the harness page loads the vendored script too");
});
