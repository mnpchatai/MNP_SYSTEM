import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// เมนู "ระบบสำนักงาน" (modules/office-sections.js + module-office.js): หน้าเลือกระบบ 2 ชั้น การซ่อนการ์ดใบแจ้งซ่อม IT จากภาพรวมคำร้อง และสิทธิ์แผนก
const require = createRequire(import.meta.url);
// ไฟล์ของ Pilot อ้างชุดไอคอนกลางผ่าน globalThis (เบราว์เซอร์โหลด ui-icons.js ก่อนเสมอ)
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
const sections = require("../../modules/office-sections.js");
const requestCenter = require("../../modules/request-center.js");
const departmentAccess = require("../../modules/department-access.js");
const labOnly = require("../../modules/lab-only-access.js");

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const params = (query) => new URLSearchParams(query);
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, " ");
const flush = () => new Promise((resolve) => setImmediate(resolve));

/* ---------- หน้าเลือกระบบ (ชั้นที่ 1) ---------- */
test("the office chooser has IT SUPPORT and HR in that order, and each names an existing palette", () => {
  assert.deepEqual(sections.SECTIONS.map((section) => [section.key, section.label]), [["it-support", "IT SUPPORT"], ["hr", "HR"]]);
  const css = read("styles.css");
  for (const section of sections.SECTIONS) assert.ok(css.includes(`[data-module="${section.palette}"]`), `${section.key} palette exists`);
  for (const card of sections.IT_SUPPORT_CARDS) assert.ok(css.includes(`[data-module="${card.palette}"]`));
  assert.ok(Object.isFrozen(sections.SECTIONS));
});

test("IT SUPPORT is a link and HR is a plain card saying the system is under development", () => {
  const page = sections.chooserPage();
  assert.match(page, /<h1>เลือกระบบ<\/h1>/);
  assert.equal(count(page, /class="type-card request-type-card lab-module-card/g), 2);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/office\?module=it-support" data-module="it"/);
  assert.doesNotMatch(page, /href="#\/office\?module=hr"/, "HR cannot be opened");
  assert.match(page, /<div class="type-card request-type-card lab-module-card is-off" data-module="pk">/);
  assert.equal(count(visibleText(page), /ระบบกำลังพัฒนา/g), 1, "the status is said once");
  assert.equal(count(visibleText(page), /IT SUPPORT/g), 1);
  assert.equal(count(visibleText(page), /HR/g), 1);
  assert.doesNotMatch(page, /style="|aria-disabled/);
});

test("?module= selects the system: none is the chooser, unknown values are not found", () => {
  assert.equal(sections.readSection(params("")), sections.HOME);
  assert.equal(sections.readSection(params("module=")), sections.HOME);
  assert.equal(sections.readSection(null), sections.HOME);
  assert.equal(sections.readSection(params("module=it-support")), "it-support");
  assert.equal(sections.readSection(params("module=hr")), "hr");
  for (const key of ["IT-SUPPORT", "it", "repair", "constructor", "__proto__"]) assert.equal(sections.readSection(params(`module=${key}`)), null);
  assert.equal(sections.sectionUrl("it-support"), "#/office?module=it-support");
  assert.equal(sections.sectionUrl("nope"), "#/office");
});

test("the HR page opened by URL is a static not-ready page", () => {
  const page = sections.notReadyPage("hr");
  assert.match(page, /<a class="request-back-link" href="#\/office">‹ เลือกระบบ<\/a>/);
  assert.match(page, /lab-module-header is-off" data-module="pk"/);
  assert.equal(count(visibleText(page), /ระบบกำลังพัฒนา/g), 1);
});

/* ---------- IT SUPPORT (ชั้นที่ 2) ---------- */
test("IT SUPPORT shows the IT repair card as a link to the existing repair list and the IT work-order card as moving", () => {
  const page = sections.itSupportPage({ repair: { href: "#/requests?type=abc", count: 3 } });
  assert.match(page, /<h1>IT SUPPORT<\/h1>/);
  assert.match(page, /<a class="request-back-link" href="#\/office">‹ เลือกระบบ<\/a>/);
  assert.equal(count(page, /class="type-card request-type-card lab-module-card/g), 2);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/requests\?type=abc" data-module="it"/);
  assert.match(page, /ใบแจ้งซ่อม IT/);
  assert.match(page, /3 ยังไม่จบ/);
  assert.match(page, /lab-module-card is-off" data-module="it"/);
  assert.equal(count(visibleText(page), /กำลังย้ายระบบ/g), 1);
  assert.equal(count(visibleText(page), /ใบสั่งงาน IT/g), 1);
  assert.equal(count(page, /<a class="type-card/g), 1, "only the repair card is a link");
  assert.doesNotMatch(page, /style="/);
});

test("the repair card falls back to a plain status label when the count is unknown, and is hidden when not allowed", () => {
  assert.match(sections.itSupportPage({ repair: { href: "#/requests?type=abc", count: null } }), /ดูสถานะ/);
  assert.match(sections.itSupportPage({ repair: { href: "#/requests?type=abc", count: 0 } }), /0 ยังไม่จบ/);
  const hidden = sections.itSupportPage({ repair: null });
  assert.doesNotMatch(hidden, /ใบแจ้งซ่อม IT/);
  assert.equal(count(hidden, /<a class="type-card/g), 0);
  assert.match(hidden, /ใบสั่งงาน IT/);
  assert.equal(sections.itSupportPage(), hidden);
});

test("an unsafe label or href is escaped", () => {
  const page = sections.itSupportPage({ repair: { href: `#/requests?type="><script>`, count: 1 } });
  assert.doesNotMatch(page, /<script>/);
});

/* ---------- ซ่อนการ์ดใบแจ้งซ่อม IT จากภาพรวมคำร้อง ---------- */
const MODULES = { MT_REPAIR: {}, MANAGEMENT: {}, NCR_CAR: {}, IT_REPAIR: { hideFromOverview: true } };
const TYPES = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR", "IT_REPAIR"].map((code) => ({ id: `id-${code}`, code }));

test("the request overview keeps MT, MG and NC and hides only the types whose module sets hideFromOverview", () => {
  const shown = requestCenter.overviewTypes(TYPES, (code) => MODULES[code] ?? null);
  assert.deepEqual(shown.map((type) => type.code), ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"]);
  assert.equal(TYPES.length, 4, "the list the pages use for selecting a type is untouched");
  assert.deepEqual(requestCenter.overviewTypes(TYPES, () => null).map((type) => type.code), TYPES.map((type) => type.code), "no flag, no hiding");
  assert.deepEqual(requestCenter.overviewTypes(undefined, () => null), []);
  assert.deepEqual(requestCenter.overviewTypes([{ code: "X" }], () => ({ hideFromOverview: "yes" })).map((type) => type.code), ["X"], "only an explicit true hides");
});

test("IT_REPAIR stays a normal request module: not standalone, flagged hidden from the overview, with its old behaviour intact", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read("modules/module-it.js"), context);
  const it = context.window.MNP_REQUEST_MODULES.IT_REPAIR;
  assert.equal(it.enabled, true);
  assert.notEqual(it.standalone, true, "standalone would drop it out of the shared request center");
  assert.equal(it.hideFromOverview, true);
  assert.equal(it.palette, "it");
  assert.equal(it.label, "ใบแจ้งซ่อม IT");
  assert.equal(typeof it.renderFields, "function");
  assert.equal(it.navPath, "office");
  assert.equal(it.parentLink.href, "#/office?module=it-support");
  assert.equal(it.nav, undefined, "no menu entry of its own");
});

test("app.js: the overview filters the card, but every other IT_REPAIR path stays", () => {
  const app = read("app.js");
  assert.match(app, /const overviewTypes = window\.MNP_REQUEST_CENTER\.overviewTypes\(types, requestModule\);/);
  assert.match(app, /requestTypeCounts\(overviewTypes, mineOnly\)/);
  assert.match(app, /requestCenterHeader\(overviewTypes, params, counts,/);
  // ส่วนอื่นของ flow IT_REPAIR ต้องคงเดิม
  assert.match(app, /NOTIFICATION_TYPE_BY_PREFIX = Object\.freeze\(\{ MT: "MT_REPAIR", MG: "MANAGEMENT", IT: "IT_REPAIR" \}\)/);
  assert.match(app, /IT_REPAIR: "สร้างใบแจ้งซ่อม IT"/);
  assert.match(app, /const ORIGINAL_FORM_TYPES = new Set\(\["IT_REPAIR"\]\)/);
  assert.match(app, /const REQUEST_MODULE_CODES = \["MT_REPAIR", "MANAGEMENT", "NCR_CAR"\];/);
  // รายการ/สร้าง/รายละเอียดยังใช้ types ครบ (activeRequestModuleCodes) ไม่ใช่ overviewTypes
  assert.equal(count(app, /\.in\("code", activeRequestModuleCodes\(\)\)/g), 2);
  assert.doesNotMatch(read("modules/module-it.js"), /standalone: true/);
});

test("pages of the hidden-card module highlight the office menu and go back to IT SUPPORT; other modules are unchanged", () => {
  const app = read("app.js");
  assert.match(app, /function requestNavFor\(typeCode\) \{\s+const entry = requestModule\(typeCode\);\s+return entry\?\.hideFromOverview && entry\.navPath \? entry\.navPath : "requests";/);
  assert.match(app, /shell\(content, requestNavFor\(selected\?\.code\), "คำร้อง", selected \?/, "status board");
  assert.match(app, /shell\(content, requestNavFor\(selected\.code\), "คำร้อง", requestTypeLabel\(selected\)\)/, "module list");
  assert.match(app, /requestNavFor\(selected\?\.code\), "คำร้อง \/ สร้างคำร้อง"/, "create form");
  assert.match(app, /shell\(content, requestNavFor\(type\?\.code\), type \? requestTypeLabel\(type\)/, "request detail");
  assert.match(app, /const parentLink = requestModule\(selected\.code\)\?\.hideFromOverview \? requestModule\(selected\.code\)\.parentLink : null;/);
  assert.match(app, /const backLabel = parentLink\?\.label \?\? "เลือกโมดูล";/);
  // ภาพรวมคำร้องเองยังไฮไลต์เมนู "คำร้อง"
  assert.match(app, /\$\{counts \? `\$\{counts\.get\(type\.id\) \?\? 0\} ยังไม่จบ` : "ดูสถานะ"\}/);
  assert.match(app, /countScope: mineOnly \? "ที่คุณแจ้ง" : "ที่คุณมีสิทธิ์ดู" \}\)\}\$\{statusList\}`, "requests", "คำร้อง"\)/);
});

/* ---------- สิทธิ์แผนก / บัญชี lab-only / โหมดทดสอบ ---------- */
const indesign = { department: { code: "ID" }, role: { code: "employee" } };
const mt = { department: { code: "MT" }, role: { code: "employee" } };

test("department ID still reaches the IT repair flow through the office menu, and nothing else is opened up", () => {
  assert.equal(departmentAccess.moduleAllowed(indesign, "OFFICE"), true, "menu entry");
  assert.equal(departmentAccess.routeAllowed(indesign, "office", "OFFICE"), true, "#/office page");
  assert.equal(departmentAccess.moduleAllowed(indesign, "IT_REPAIR"), true);
  assert.equal(departmentAccess.routeAllowed(indesign, "requests"), true, "the repair list is a shared page");
  for (const code of ["MANAGEMENT", "NCR_CAR", "MNP_LAB", "MASTER", "BOM"]) assert.equal(departmentAccess.moduleAllowed(indesign, code), false, `${code} stays hidden`);
  assert.equal(departmentAccess.routeAllowed(indesign, "lab", "MNP_LAB"), false);
  assert.equal(departmentAccess.routeAllowed(indesign, "admin"), false);
});

test("other departments see the office menu; lab-only accounts do not", () => {
  assert.equal(departmentAccess.moduleAllowed(mt, "OFFICE"), true);
  assert.equal(departmentAccess.routeAllowed(mt, "office", "OFFICE"), true);
  assert.equal(labOnly.moduleAllowed("OFFICE"), false, "the side menu keeps only MNP LAB for lab-only accounts");
  assert.equal(labOnly.routeAllowed("office"), false, "typing #/office sends a lab-only account back to LAB");
});

test("the office module is standalone with a menu entry, no sandbox support, and loads right after MNP LAB and before app.js", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  const at = (file) => scripts.indexOf(file);
  assert.ok(at("modules/office-sections.js") >= 0 && at("modules/module-office.js") >= 0);
  assert.ok(at("modules/office-sections.js") < at("modules/module-office.js"));
  assert.equal(at("modules/module-office.js"), at("modules/module-lab.js") + 2, "menu order follows load order: LAB, then office");
  assert.ok(at("modules/module-office.js") < at("app.js"));
  assert.ok(at("modules/ui-icons.js") < at("modules/office-sections.js"));

  const source = read("modules/module-office.js");
  assert.match(source, /standalone: true,/);
  assert.match(source, /nav: \[\{ path: PATH, label: TITLE, icon: NAV_ICON \}\]/);
  assert.match(source, /const TITLE = "ระบบสำนักงาน";/);
  assert.doesNotMatch(source, /sandbox: true/, "hidden in test mode, like MNP LAB");
});

/* ---------- ทดลองรันโมดูลจริงใน vm: ลงทะเบียน เมนู และหน้า ---------- */
function setup({ employee, repairType = { id: "type-it", code: "IT_REPAIR" }, countResult = 5 } = {}) {
  const queries = [];
  const painted = { html: "", active: null, title: null, notFound: 0, loading: 0, zooms: 0, queued: [] };
  const window = {};
  const context = vm.createContext({
    window, console, URLSearchParams, Map, Set,
    location: { hash: "#/office?module=it-support" },
    document: { querySelectorAll: () => [] },
    state: { employee },
    app: { set innerHTML(value) { painted.html = value; }, get innerHTML() { return painted.html; } },
    sb: { from: (table) => ({ select: () => ({ eq: (column, value) => ({ eq: (column2, value2) => ({ maybeSingle: async () => {
      queries.push({ table, [column]: value, [column2]: value2 });
      return { data: repairType, error: null };
    } }) }) }) }) },
    shell: (html, active, title) => { painted.active = active; painted.title = title; return html; },
    bindShell() {}, loadingShell() { painted.loading += 1; }, renderNotFound() { painted.notFound += 1; },
    zoomIntoContent() { painted.zooms += 1; }, queueModuleZoom(hash) { painted.queued.push(hash); },
    requestTypeCounts: async (types, mineOnly) => { queries.push({ counted: types.map((type) => type.id), mineOnly }); return new Map([[types[0].id, countResult]]); },
    deptModuleAllowed: (code) => departmentAccess.moduleAllowed(context.state.employee, code),
  });
  for (const file of ["ui-icons.js", "request-center.js", "module-it.js", "office-sections.js", "module-office.js"]) vm.runInContext(read(`modules/${file}`), context);
  return { context, window, queries, painted, open: (query = "") => window.MNP_REQUEST_MODULES.OFFICE.pages.office(params(query)) };
}

test("module-office registers a standalone menu entry visible to any signed-in user", () => {
  const { window } = setup({ employee: mt });
  const office = window.MNP_REQUEST_MODULES.OFFICE;
  assert.equal(office.code, "OFFICE");
  assert.equal(office.enabled, true);
  assert.equal(office.standalone, true);
  assert.equal(office.sandbox, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(office.nav.map((item) => [item.path, item.label]))), [["office", "ระบบสำนักงาน"]]);
  assert.match(office.nav[0].icon, /<svg/);
  assert.equal(office.navAllowed(mt), true);
  assert.equal(office.navAllowed(null), false);
  assert.equal(typeof office.pages.office, "function");
  assert.ok(window.MNP_REQUEST_MODULES.IT_REPAIR, "the repair module is registered next to it");
  assert.notEqual(window.MNP_REQUEST_MODULES.IT_REPAIR.standalone, true);
});

test("opening #/office paints the chooser without touching the database", async () => {
  const app = setup({ employee: mt });
  await app.open("");
  assert.equal(app.painted.active, "office");
  assert.match(app.painted.html, /เลือกระบบ/);
  assert.deepEqual(app.queries, []);
});

test("opening IT SUPPORT looks up the active IT_REPAIR type and links to the original repair list with the pending count", async () => {
  const app = setup({ employee: mt });
  await app.open("module=it-support");
  assert.deepEqual(app.queries[0], { table: "request_types", code: "IT_REPAIR", is_active: true });
  assert.deepEqual(JSON.parse(JSON.stringify(app.queries[1])), { counted: ["type-it"], mineOnly: false });
  assert.match(app.painted.html, /href="#\/requests\?type=type-it"/, "the exact list URL that the old overview card opened");
  assert.match(app.painted.html, /5 ยังไม่จบ/);
  assert.match(app.painted.html, /กำลังย้ายระบบ/);
  assert.equal(app.painted.active, "office");
  assert.equal(app.painted.title, "IT SUPPORT");
});

test("the repair card link equals the helper the request center itself uses", async () => {
  const app = setup({ employee: mt });
  await app.open("module=it-support");
  assert.equal(requestCenter.url(params(""), { type: "type-it" }), "#/requests?type=type-it");
});

test("a department without IT_REPAIR, or a database that turned the type off, gets no repair card", async () => {
  const restricted = setup({ employee: { department: { code: "ID" } } });
  restricted.context.deptModuleAllowed = () => false;
  await restricted.open("module=it-support");
  assert.doesNotMatch(restricted.painted.html, /ใบแจ้งซ่อม IT/);
  assert.deepEqual(restricted.queries, [], "no lookups for a card that is not shown");

  const off = setup({ employee: mt, repairType: null });
  await off.open("module=it-support");
  assert.doesNotMatch(off.painted.html, /ใบแจ้งซ่อม IT/);
});

test("department ID, which is restricted, still gets the repair card", async () => {
  const app = setup({ employee: indesign });
  await app.open("module=it-support");
  assert.match(app.painted.html, /href="#\/requests\?type=type-it"/);
});

test("a count that fails does not break the page, HR opens a static page, and an unknown module is not found", async () => {
  const app = setup({ employee: mt });
  app.context.requestTypeCounts = async () => { throw new Error("boom"); };
  await app.open("module=it-support");
  assert.match(app.painted.html, /ดูสถานะ/);
  assert.match(app.painted.html, /href="#\/requests\?type=type-it"/);

  const other = setup({ employee: mt });
  await other.open("module=hr");
  assert.match(other.painted.html, /ระบบกำลังพัฒนา/);
  assert.deepEqual(other.queries, []);
  await other.open("module=unknown");
  assert.equal(other.painted.notFound, 1);
});

test("a slow IT SUPPORT page does not repaint over a page opened after it", async () => {
  const app = setup({ employee: mt });
  let release;
  app.context.sb.from = () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => new Promise((resolve) => { release = resolve; }) }) }) }) });
  const slow = app.open("module=it-support");
  await flush();
  await app.open("");
  const chooser = app.painted.html;
  release({ data: { id: "late", code: "IT_REPAIR" }, error: null });
  await slow;
  assert.equal(app.painted.html, chooser);
});
