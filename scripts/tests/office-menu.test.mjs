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
  for (const key of ["IT-SUPPORT", "it", "REPAIR", "constructor", "__proto__"]) assert.equal(sections.readSection(params(`module=${key}`)), null);
  // หน้าย่อยของ IT SUPPORT: ใบแจ้งซ่อม IT (itrp) กับใบสั่งงาน IT (itwo)
  assert.equal(sections.readSection(params("module=repair")), "repair");
  assert.equal(sections.readSection(params("module=work-order")), "work-order");
  assert.equal(sections.sectionUrl("repair"), "#/office?module=repair");
  assert.equal(sections.sectionUrl("work-order"), "#/office?module=work-order");
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
test("IT SUPPORT shows the IT repair card and the IT work-order card, both as links to their own pages", () => {
  const page = sections.itSupportPage();
  assert.match(page, /<h1>IT SUPPORT<\/h1>/);
  assert.match(page, /<a class="request-back-link" href="#\/office">‹ เลือกระบบ<\/a>/);
  assert.equal(count(page, /class="type-card request-type-card lab-module-card/g), 2);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/office\?module=repair" data-module="it"/);
  assert.match(page, /<a class="type-card request-type-card lab-module-card" href="#\/office\?module=work-order" data-module="it"/);
  assert.ok(page.indexOf("module=repair") < page.indexOf("module=work-order"), "the repair card comes first");
  assert.equal(count(visibleText(page), /ใบแจ้งซ่อม IT/g), 1);
  assert.equal(count(visibleText(page), /ใบสั่งงาน IT/g), 1);
  assert.doesNotMatch(page, /is-off/, "both cards are open");
  assert.doesNotMatch(page, /#\/requests/, "the repair card no longer opens the shared request list");
  assert.doesNotMatch(visibleText(page), /กำลังย้ายระบบ/);
  assert.equal(count(page, /<a class="type-card/g), 2, "both cards are links");
  assert.doesNotMatch(page, /style="/);
});
test("a card the department may not open is left out, and a card that declares nothing shows no badge", () => {
  const noRepair = sections.itSupportPage({ allowed: (code) => code !== "IT_COMPUTER_REPAIR" });
  assert.doesNotMatch(noRepair, /ใบแจ้งซ่อม IT/);
  assert.equal(count(noRepair, /<a class="type-card/g), 1, "only the work-order card is left, and it is a link");
  assert.match(noRepair, /href="#\/office\?module=work-order"/);
  const noWork = sections.itSupportPage({ allowed: (code) => code !== "IT_WORK_ORDER" });
  assert.doesNotMatch(noWork, /ใบสั่งงาน IT/);
  assert.match(noWork, /href="#\/office\?module=repair"/);
  assert.doesNotMatch(sections.itSupportPage(), /request-type-count|request-type-version/, "nothing declared = no badge and no version");
  assert.equal(sections.itSupportPage({}), sections.itSupportPage());
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

test("the office module is standalone with a menu entry, sandbox for the repair and work-order pages only, and loads right after MNP LAB and before app.js", () => {
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
  assert.match(source, /sandbox: true,/, "test mode keeps the menu for the work-order pages (modeAllowed hides the rest)");
  assert.match(source, /const modeAllowed = \(code\) => deptModuleAllowed\(code\) && \(!inSandbox\(\) \|\| code === sections\.WORK_ORDER_CODE \|\| code === sections\.REPAIR_CODE\);/);
  // ไฟล์ของใบแจ้งซ่อม IT (itrp) โหลดหลัง module-office.js และก่อน app.js ตามลำดับ model → pages → module เช่นกัน
  assert.ok(at("modules/itrp-model.js") < at("modules/itrp-pages.js") && at("modules/itrp-pages.js") < at("modules/itrp-history-pages.js") && at("modules/itrp-history-pages.js") < at("modules/module-itrp.js"));
  assert.ok(at("modules/module-office.js") < at("modules/module-itrp.js") && at("modules/module-itrp.js") < at("app.js"));
  // ไฟล์ของใบสั่งงาน IT โหลดหลัง module-office.js และก่อน app.js ตามลำดับ model → pages → module
  assert.ok(at("modules/itwo-model.js") < at("modules/itwo-pages.js") && at("modules/itwo-pages.js") < at("modules/module-itwo.js"));
  assert.ok(at("modules/module-office.js") < at("modules/module-itwo.js") && at("modules/module-itwo.js") < at("app.js"));
});

/* ---------- ทดลองรันโมดูลจริงใน vm: ลงทะเบียน เมนู และหน้า ---------- */
function setup({ employee, repairSummary = { openCount: 5, badge: "", title: "" }, repairVersion = "1.00", itwoSummary = null, itwoVersion, declare = true, sandbox = false, repairInDevelopment = false } = {}) {
  const queries = [];
  const painted = { itwoRendered: [], itrpRendered: [], html: "", active: null, title: null, notFound: 0, loading: 0, zooms: 0, queued: [], went: [] };
  // หน้าจริงของใบสั่งงาน IT / ใบแจ้งซ่อม IT อยู่ที่ module-itwo.js / module-itrp.js (ทดสอบที่ itwo-module.test.mjs / itrp-module.test.mjs) ที่นี่ใช้ตัวแทนที่บันทึกการเรียกและคืนตัวเลขบนการ์ด
  const itwo = { render: async (query) => { painted.itwoRendered.push(String(query)); }, loadCardSummary: async () => (itwoSummary instanceof Error ? Promise.reject(itwoSummary) : itwoSummary), version: itwoVersion };
  const itrp = { render: async (query) => { painted.itrpRendered.push(String(query)); }, loadCardSummary: async () => (repairSummary instanceof Error ? Promise.reject(repairSummary) : repairSummary), version: repairVersion };
  // โมดูลประกาศตัวเองให้การ์ด (window.MNP_OFFICE_CARDS[รหัสโมดูล]) · declare: false = โมดูลที่ไม่ประกาศ
  const window = {
    MNP_ITWO: itwo, MNP_ITRP: itrp,
    MNP_OFFICE_CARDS: declare ? { IT_WORK_ORDER: { version: itwoVersion, loadCardSummary: itwo.loadCardSummary }, IT_COMPUTER_REPAIR: { version: repairVersion, inDevelopment: repairInDevelopment, loadCardSummary: itrp.loadCardSummary } } : {},
  };
  const context = vm.createContext({
    window, console, URLSearchParams, Map, Set, isSandboxMode: () => sandbox,
    location: { hash: "#/office?module=it-support" },
    document: { querySelectorAll: () => [] },
    state: { employee },
    app: { set innerHTML(value) { painted.html = value; }, get innerHTML() { return painted.html; } },
    // หน้าระบบสำนักงานไม่ต้องอ่านฐานข้อมูลเองแล้ว (ตัวเลขบนการ์ดมาจากตัวประกาศของโมดูล) ถ้ามีใครเรียก sb / requestTypeCounts จะถูกบันทึกลง queries
    sb: { from: (table) => { queries.push({ table }); throw new Error("the office page must not query the database"); } },
    shell: (html, active, title) => { painted.active = active; painted.title = title; return html; },
    bindShell() {}, loadingShell() { painted.loading += 1; }, renderNotFound() { painted.notFound += 1; }, go(path) { painted.went.push(path); },
    zoomIntoContent() { painted.zooms += 1; }, queueModuleZoom(hash) { painted.queued.push(hash); },
    requestTypeCounts: async () => { queries.push({ counted: true }); return new Map(); },
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
  assert.equal(office.sandbox, true);
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

test("opening IT SUPPORT paints the two cards with their own links, the repair card's count and version, and makes no database lookup", async () => {
  const app = setup({ employee: mt });
  await app.open("module=it-support");
  assert.deepEqual(app.queries, [], "the card numbers come from the modules' own summaries");
  assert.match(app.painted.html, /href="#\/office\?module=repair"/);
  assert.match(app.painted.html, />5 ยังไม่จบ<\/span>/);
  assert.match(app.painted.html, />V1\.00<\/span>/);
  assert.match(app.painted.html, /href="#\/office\?module=work-order"/);
  assert.doesNotMatch(app.painted.html, /#\/requests|กำลังย้ายระบบ/);
  assert.equal(app.painted.active, "office");
  assert.equal(app.painted.title, "IT SUPPORT");
});

test("a card whose module is in development shows the 'กำลังพัฒนา' tag next to the count and version, and is still a link", () => {
  const modules = { IT_COMPUTER_REPAIR: { version: "1.00", openCount: 2, waiting: "1 รอคุณ", inDevelopment: true }, IT_WORK_ORDER: { version: "1.04", openCount: 3 } };
  const page = sections.itSupportPage({ modules });
  const repair = page.split("<a ").find((card) => card.includes("module=repair"));
  const work = page.split("<a ").find((card) => card.includes("module=work-order"));
  assert.match(repair, /<span class="request-type-count request-type-dev">กำลังพัฒนา<\/span>/);
  assert.equal(count(page, /request-type-dev/g), 1, "only the card whose module declares it");
  assert.doesNotMatch(work, /กำลังพัฒนา/);
  assert.match(repair, /^class="type-card request-type-card lab-module-card" href="#\/office\?module=repair"/, "still an open link, not a disabled card");
  assert.doesNotMatch(page, /is-off/);
  // ป้ายอยู่ในคอลัมน์ป้ายเดียวกับตัวเลขและเลขเวอร์ชัน เรียงก่อนกัน ไม่ซ้อนทับ
  const order = [">กำลังพัฒนา<", ">2 ยังไม่จบ<", ">1 รอคุณ<", ">V1.00<"].map((text) => repair.indexOf(text));
  assert.ok(order.every((index) => index > 0) && order.every((index, position) => position === 0 || index > order[position - 1]), "tag, count, waiting, version in order");
  // ถอดธง = ป้ายหาย
  const off = sections.itSupportPage({ modules: { IT_COMPUTER_REPAIR: { version: "1.00", openCount: 2, inDevelopment: false } } });
  assert.doesNotMatch(off, /กำลังพัฒนา|request-type-dev/);
  // ไม่มีป้ายตัวเลข/เวอร์ชันเลยก็ยังขึ้นป้ายได้
  assert.match(sections.itSupportPage({ modules: { IT_COMPUTER_REPAIR: { inDevelopment: true } } }), /request-type-side"><span class="request-type-count request-type-dev">กำลังพัฒนา<\/span><\/span>/);
});

test("the real office module passes the module's development flag to the card", async () => {
  const on = setup({ employee: mt, repairInDevelopment: true });
  await on.open("module=it-support");
  assert.equal(count(on.painted.html, /request-type-dev">กำลังพัฒนา</g), 1);
  assert.match(on.painted.html, /href="#\/office\?module=repair"/);
  const off = setup({ employee: mt });
  await off.open("module=it-support");
  assert.doesNotMatch(off.painted.html, /กำลังพัฒนา/);
});

test("?module=repair hands the page to the repair module; the old request-center IT_REPAIR module is still registered but has no card", async () => {
  const app = setup({ employee: mt });
  await app.open("module=repair&view=new");
  assert.deepEqual(app.painted.itrpRendered, ["module=repair&view=new"]);
  assert.deepEqual(app.painted.itwoRendered, []);
  assert.equal(app.painted.html, "", "the office module paints nothing itself");
  assert.deepEqual(app.painted.went, []);
  assert.ok(app.window.MNP_REQUEST_MODULES.IT_REPAIR, "the central IT_REPAIR module is not removed");
  assert.equal(sections.IT_SUPPORT_CARDS.some((card) => card.code === "IT_REPAIR"), false, "but no card points at it");
});
test("a department without IT_COMPUTER_REPAIR gets no repair card and nothing is asked for it", async () => {
  let asked = 0;
  const restricted = setup({ employee: { department: { code: "ID" } } });
  restricted.context.deptModuleAllowed = (code) => code !== "IT_COMPUTER_REPAIR";
  restricted.window.MNP_OFFICE_CARDS.IT_COMPUTER_REPAIR.loadCardSummary = async () => { asked += 1; return { openCount: 1 }; };
  await restricted.open("module=it-support");
  assert.doesNotMatch(restricted.painted.html, /ใบแจ้งซ่อม IT/);
  assert.match(restricted.painted.html, /ใบสั่งงาน IT/, "the other card of the page is still there");
  assert.equal(asked, 0, "no summary is read for a card that is not shown");
  assert.deepEqual(restricted.queries, []);
  await restricted.open("module=repair");
  assert.deepEqual(restricted.painted.went, ["dashboard"], "typing the URL is turned back before anything is rendered");
  assert.deepEqual(restricted.painted.itrpRendered, []);
});
test("department ID, which is restricted, still gets the repair card and can open the repair module (but not the work-order module)", async () => {
  const app = setup({ employee: indesign });
  await app.open("module=it-support");
  assert.match(app.painted.html, /href="#\/office\?module=repair"/);
  assert.doesNotMatch(app.painted.html, /module=work-order/);
  await app.open("module=repair");
  assert.equal(app.painted.itrpRendered.length, 1);
  assert.deepEqual(app.painted.went, []);
  await app.open("module=work-order");
  assert.deepEqual(app.painted.went, ["dashboard"]);
  assert.deepEqual(app.painted.itwoRendered, []);
  assert.equal(departmentAccess.moduleAllowed(indesign, "IT_COMPUTER_REPAIR"), true);
  assert.equal(departmentAccess.moduleAllowed(indesign, "IT_WORK_ORDER"), false);
});
/* ---------- แผนก ID: การ์ดในเมนูกรองตามรหัสโมดูลของแต่ละการ์ด ---------- */
const allowedFor = (employee) => (code) => departmentAccess.moduleAllowed(employee, code);

test("every card has its own module code, and the IT SUPPORT hub has none of its own", () => {
  assert.deepEqual(sections.IT_SUPPORT_CARDS.map((card) => [card.key, card.code]), [["repair", "IT_COMPUTER_REPAIR"], ["work-order", "IT_WORK_ORDER"]]);
  const hr = sections.SECTIONS.find((section) => section.key === "hr");
  assert.equal(hr.code, "HR");
  const hub = sections.SECTIONS.find((section) => section.key === "it-support");
  assert.equal(hub.code, undefined);
  assert.equal(hub.cards, sections.IT_SUPPORT_CARDS);
});

test("an unrestricted department sees every system and every card, exactly as before", () => {
  const allowed = allowedFor(mt);
  assert.deepEqual(sections.visibleSections(allowed).map((section) => section.key), ["it-support", "hr"]);
  assert.deepEqual(sections.visibleCards(allowed).map((card) => card.key), ["repair", "work-order"]);
  assert.equal(sections.hasVisibleSection(allowed), true);
  assert.equal(sections.chooserPage({ allowed }), sections.chooserPage(), "no allowed callback = the same page");
  assert.equal(sections.itSupportPage({ allowed }), sections.itSupportPage());
  assert.equal(count(sections.chooserPage({ allowed }), /class="type-card request-type-card lab-module-card/g), 2);
});

test("department ID sees the office menu and only IT SUPPORT, and in it only the IT repair card", () => {
  const allowed = allowedFor(indesign);
  assert.equal(departmentAccess.moduleAllowed(indesign, "OFFICE"), true, "OFFICE stays in the allowlist only to open the menu and hub");
  assert.equal(departmentAccess.moduleAllowed(indesign, "HR"), false);
  assert.equal(departmentAccess.moduleAllowed(indesign, "IT_WORK_ORDER"), false);
  assert.equal(departmentAccess.routeAllowed(indesign, "office", "OFFICE"), true, "the hub page opens");
  assert.equal(sections.hasVisibleSection(allowed), true, "the menu is shown");
  assert.deepEqual(sections.visibleSections(allowed).map((section) => section.key), ["it-support"]);
  assert.deepEqual(sections.visibleCards(allowed).map((card) => card.key), ["repair"]);

  const chooser = sections.chooserPage({ allowed });
  assert.equal(count(chooser, /class="type-card request-type-card lab-module-card/g), 1);
  assert.match(chooser, /href="#\/office\?module=it-support"/);
  assert.doesNotMatch(visibleText(chooser), /HR/);
  assert.doesNotMatch(chooser, /ระบบกำลังพัฒนา/);

  const hub = sections.itSupportPage({ modules: { IT_COMPUTER_REPAIR: { version: "1.00", openCount: 2 } }, allowed });
  assert.match(hub, /ใบแจ้งซ่อม IT/);
  assert.match(hub, /2 ยังไม่จบ/);
  assert.doesNotMatch(hub, /ใบสั่งงาน IT/);
  assert.doesNotMatch(hub, /กำลังย้ายระบบ/);
  assert.equal(count(hub, /class="type-card request-type-card lab-module-card/g), 1);
});

test("a department left with no card at all has no office menu and no system to open", () => {
  const allowed = () => false;
  assert.deepEqual(sections.visibleSections(allowed), []);
  assert.equal(sections.hasVisibleSection(allowed), false);
  // ระบบที่มีการ์ดลูกเห็นได้เมื่อมีการ์ดลูกใบเดียวพอ แม้ระบบเองไม่มีรหัส
  assert.equal(sections.hasVisibleSection((code) => code === "IT_WORK_ORDER"), true);
  assert.equal(sections.hasVisibleSection((code) => code === "HR"), true);
  assert.equal(sections.hasVisibleSection((code) => code === "OFFICE"), false, "OFFICE alone opens nothing");
});

test("department ID in the real module: menu shown, hub shows only IT SUPPORT, the repair card shows only the repair card", async () => {
  const app = setup({ employee: indesign });
  const office = app.window.MNP_REQUEST_MODULES.OFFICE;
  assert.equal(office.navAllowed(indesign), true);

  await app.open("");
  assert.deepEqual(app.painted.went, []);
  assert.match(app.painted.html, /IT SUPPORT/);
  assert.doesNotMatch(app.painted.html, /HR/);

  await app.open("module=it-support");
  assert.deepEqual(app.painted.went, []);
  assert.match(app.painted.html, /href="#\/office\?module=repair"/);
  assert.doesNotMatch(app.painted.html, /ใบสั่งงาน IT|กำลังย้ายระบบ/);
});

test("department ID typing #/office?module=hr is sent home like any other module it may not open, with nothing painted or fetched", async () => {
  const app = setup({ employee: indesign });
  await app.open("module=hr");
  assert.deepEqual(app.painted.went, ["dashboard"]);
  assert.equal(app.painted.html, "");
  assert.equal(app.painted.notFound, 0);
  assert.deepEqual(app.queries, []);
  // ระบบที่ไม่มีจริงยังเป็นหน้า "ไม่พบ" เหมือนทุกคน
  await app.open("module=unknown");
  assert.equal(app.painted.notFound, 1);
  assert.deepEqual(app.painted.went, ["dashboard"]);
});

test("a department that may open nothing in the office has no menu entry and is sent home from every office URL", async () => {
  const app = setup({ employee: indesign });
  app.context.deptModuleAllowed = () => false;
  assert.equal(app.window.MNP_REQUEST_MODULES.OFFICE.navAllowed(indesign), false);
  await app.open("");
  await app.open("module=it-support");
  assert.deepEqual(app.painted.went, ["dashboard", "dashboard"]);
  assert.equal(app.painted.html, "");
  assert.deepEqual(app.queries, []);
});

test("other departments still see the whole office menu through the real module", async () => {
  const app = setup({ employee: mt });
  await app.open("");
  assert.match(app.painted.html, /IT SUPPORT/);
  assert.match(app.painted.html, /HR/);
  assert.deepEqual(app.painted.went, []);
  await app.open("module=hr");
  assert.match(app.painted.html, /ระบบกำลังพัฒนา/);
  assert.deepEqual(app.painted.went, []);
});

test("the IT SUPPORT system uses a wrench icon that already exists in the shared icon set, and the back link reads with a space", () => {
  const hub = sections.SECTIONS.find((section) => section.key === "it-support");
  assert.equal(hub.icon, "wrench");
  assert.notEqual(globalThis.MNP_UI_ICONS.icon("wrench"), "");
  assert.notEqual(globalThis.MNP_UI_ICONS.icon("wrench"), globalThis.MNP_UI_ICONS.icon("settings"));
  assert.match(read("app.js"), /aria-label="ย้อนกลับไป \$\{escapeHtml\(backLabel\)\}"/);
  assert.match(read("modules/office-sections.js"), /scripts\/tests\/office-menu\.test\.mjs/);
  assert.doesNotMatch(read("modules/office-sections.js"), /office-sections\.test/);
});

test("a card summary that fails does not break the page, HR opens a static page, and an unknown module is not found", async () => {
  const app = setup({ employee: mt, repairSummary: new Error("boom") });
  await app.open("module=it-support");
  assert.match(app.painted.html, /ดูสถานะ/);
  assert.match(app.painted.html, /href="#\/office\?module=repair"/);

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
  app.window.MNP_OFFICE_CARDS.IT_COMPUTER_REPAIR.loadCardSummary = () => new Promise((resolve) => { release = resolve; });
  const slow = app.open("module=it-support");
  await flush();
  await app.open("");
  const chooser = app.painted.html;
  release({ openCount: 99 });
  await slow;
  assert.equal(app.painted.html, chooser);
});
/* ---------- ใบสั่งงาน IT: การ์ด เส้นทาง และสิทธิ์แผนก/โหมดทดสอบ ---------- */
test("the work-order card shows the count of work waiting for me, and a failing count leaves the card open", async () => {
  const withCount = setup({ employee: mt, itwoSummary: { badge: "3 รอคุณ", title: "รออนุมัติ 2 · งาน IT ค้าง 1" } });
  await withCount.open("module=it-support");
  assert.match(withCount.painted.html, /href="#\/office\?module=work-order"[^>]*title="รออนุมัติ 2 · งาน IT ค้าง 1"/);
  assert.match(withCount.painted.html, /3 รอคุณ/);

  for (const itwoSummary of [new Error("boom"), null]) {
    const app = setup({ employee: mt, itwoSummary });
    await app.open("module=it-support");
    assert.match(app.painted.html, /href="#\/office\?module=work-order"/, "still a link");
    assert.doesNotMatch(app.painted.html, /รอคุณ/);
    assert.match(app.painted.html, /5 ยังไม่จบ/, "the repair card is not affected");
  }
});

test("?module=work-order hands the page to the work-order module; department ID is sent home before anything is read", async () => {
  const app = setup({ employee: mt });
  await app.open("module=work-order&view=new");
  assert.deepEqual(app.painted.itwoRendered, ["module=work-order&view=new"]);
  assert.equal(app.painted.html, "", "the office module paints nothing itself");
  assert.deepEqual(app.painted.went, []);

  const restricted = setup({ employee: indesign });
  await restricted.open("module=work-order");
  assert.deepEqual(restricted.painted.went, ["dashboard"]);
  assert.deepEqual(restricted.painted.itwoRendered, []);
  assert.deepEqual(restricted.queries, []);
});

test("in test mode the work-order pages open normally and an HR page sends the admin back to the chooser without any lookup", async () => {
  const sandbox = setup({ employee: mt, sandbox: true });
  await sandbox.open("module=work-order");
  assert.equal(sandbox.painted.itwoRendered.length, 1);
  assert.deepEqual(sandbox.painted.went, []);
  // หน้าเลือกระบบ/IT SUPPORT/HR ในโหมดทดสอบไม่มีอะไรให้เปิดนอกจากใบสั่งงาน IT → พากลับหน้าเลือกระบบ (office) ไม่ใช่ dashboard
  await sandbox.open("module=hr");
  assert.deepEqual(sandbox.painted.went, ["office"]);
  assert.deepEqual(sandbox.queries, [], "the repair type is never looked up in test mode");
});

test("in test mode the repair and work-order pages open normally, and IT SUPPORT shows both cards with no HR and no database lookup", async () => {
  const sandbox = setup({ employee: mt, sandbox: true });
  await sandbox.open("module=repair");
  assert.equal(sandbox.painted.itrpRendered.length, 1);
  assert.deepEqual(sandbox.painted.went, []);
  await sandbox.open("module=it-support");
  assert.match(sandbox.painted.html, /href="#\/office\?module=repair"/);
  assert.match(sandbox.painted.html, /href="#\/office\?module=work-order"/);
  assert.doesNotMatch(sandbox.painted.html, /href="#\/requests/);
  assert.deepEqual(sandbox.painted.went, []);
  assert.deepEqual(sandbox.queries, []);

  await sandbox.open("");
  assert.match(visibleText(sandbox.painted.html), /IT SUPPORT/);
  assert.doesNotMatch(visibleText(sandbox.painted.html), /HR/);
  assert.equal(count(sandbox.painted.html, /class="type-card request-type-card lab-module-card/g), 1);
  assert.deepEqual(sandbox.queries, []);
});
/* ---------- ป้ายบนการ์ด (รุ่น 1.03): เลขเวอร์ชัน · ยังไม่จบ · รอคุณ — กลไกกลางของโมดูลที่ประกาศตัวเอง ---------- */
const workOrderCard = (page) => page.slice(page.indexOf('href="#/office?module=work-order"'));
const repairCard = (page) => page.slice(page.indexOf('href="#/office?module=repair"'), page.indexOf('href="#/office?module=work-order"'));

test("a card shows, top to bottom at its right: the open count, the waiting badge and the module version, for a module that declares them", () => {
  const page = sections.itSupportPage({ modules: { IT_WORK_ORDER: { version: "1.03", openCount: 4, waiting: "2 รอคุณ", title: "รออนุมัติ 2" } } });
  const card = workOrderCard(page);
  assert.match(card, /<span class="request-type-side"><span class="request-type-count">4 ยังไม่จบ<\/span><span class="request-type-count request-type-count-2">2 รอคุณ<\/span><span class="request-type-version" title="เวอร์ชัน 1\.03">V1\.03<\/span><\/span>/);
  assert.match(page, /href="#\/office\?module=work-order"[^>]*title="รออนุมัติ 2"/);
  assert.equal(count(page, /request-type-version/g), 1, "one version on the page");
  assert.equal(count(visibleText(page), /V1\.03/g), 1);
});

test("the open-count badge sits in the same element, place and wording on the repair card and the work-order card", () => {
  const page = sections.itSupportPage({ modules: { IT_COMPUTER_REPAIR: { version: "1.00", openCount: 3 }, IT_WORK_ORDER: { version: "1.03", openCount: 0 } } });
  assert.match(repairCard(page), /<span class="request-type-top"><span class="type-card-badge">[\s\S]*?<\/span><span class="request-type-side"><span class="request-type-count">3 ยังไม่จบ<\/span><span class="request-type-version"/);
  assert.match(workOrderCard(page), /<span class="request-type-top"><span class="type-card-badge">[\s\S]*?<\/span><span class="request-type-side"><span class="request-type-count">0 ยังไม่จบ<\/span><span class="request-type-version"/, "a real zero is shown as 0, first in the column");
});
test("an open count that could not be read shows 'ดูสถานะ' (like the repair card), and a module without a count shows no main badge", () => {
  const unreadable = workOrderCard(sections.itSupportPage({ modules: { IT_WORK_ORDER: { version: "1.03", openCount: null, waiting: "", title: "" } } }));
  assert.match(unreadable, /<span class="request-type-count">ดูสถานะ<\/span>/);
  assert.doesNotMatch(unreadable, /ยังไม่จบ/);
  const versionOnly = workOrderCard(sections.itSupportPage({ modules: { IT_WORK_ORDER: { version: "1.03" } } }));
  assert.doesNotMatch(versionOnly, /request-type-count/, "the module declares no count: no badge to make up");
  assert.match(versionOnly, /request-type-version/);
  const repair = sections.itSupportPage({ modules: { IT_COMPUTER_REPAIR: { version: "1.00", openCount: null } } });
  assert.match(repairCard(repair), /<span class="request-type-count">ดูสถานะ<\/span>/);
});

test("a module that does not declare anything shows no version and no badge, and the markup is unchanged for it", () => {
  const page = sections.itSupportPage({ modules: { IT_WORK_ORDER: { version: "1.03", openCount: 1 } } });
  assert.doesNotMatch(repairCard(page), /request-type-version|request-type-side|request-type-count/, "the repair card declares nothing here");
  const none = sections.itSupportPage();
  assert.doesNotMatch(none, /request-type-version|request-type-side/);
  assert.equal(sections.itSupportPage({ modules: {} }), sections.itSupportPage());
  assert.equal(count(workOrderCard(none), /request-type-count/g), 0, "not declared: no badge");
  // ตัวประกาศของโมดูลอื่น (รหัสไม่ตรงกับการ์ดใด) ไม่ทำให้การ์ดใดแสดงอะไร
  assert.equal(sections.itSupportPage({ modules: { SOME_FUTURE_MODULE: { version: "9.99", openCount: 9 } } }), sections.itSupportPage());
});
test("an unsafe version, count text or title is escaped", () => {
  const page = sections.itSupportPage({ modules: { IT_WORK_ORDER: { version: "<img src=x onerror=1>", openCount: 1, waiting: "<b>x</b>", title: '"><script>alert(1)</script>' } } });
  assert.doesNotMatch(page, /<img|<b>|<script/);
});

test("module-office reads every declared module's version and open count and passes them to the card", async () => {
  const withVersion = setup({ employee: mt, itwoVersion: "1.03", itwoSummary: { openCount: 5, badge: "2 รอคุณ", title: "รออนุมัติ 2" } });
  await withVersion.open("module=it-support");
  const card = workOrderCard(withVersion.painted.html);
  assert.match(card, />5 ยังไม่จบ<\/span>/);
  assert.match(card, />2 รอคุณ<\/span>/);
  assert.match(card, />V1\.03<\/span>/);
  assert.equal(count(withVersion.painted.html, /request-type-version/g), 2, "each declaring card shows its own version");
  assert.match(repairCard(withVersion.painted.html), />V1\.00<\/span>/);
  assert.match(repairCard(withVersion.painted.html), />5 ยังไม่จบ<\/span>/, "the repair card keeps its own count");
  const without = setup({ employee: mt, declare: false });
  await without.open("module=it-support");
  assert.doesNotMatch(without.painted.html, /request-type-version/);
  assert.doesNotMatch(without.painted.html, /request-type-count/, "a module that does not declare has no badge");
});

test("module-office: a summary that is null, throws or has no number leaves the card open with 'ดูสถานะ'; a count of 0 shows 0", async () => {
  for (const itwoSummary of [null, new Error("boom"), { badge: "", title: "" }, { openCount: "7" }]) {
    const app = setup({ employee: mt, itwoVersion: "1.03", itwoSummary });
    await app.open("module=it-support");
    const card = workOrderCard(app.painted.html);
    assert.match(card, /<span class="request-type-count">ดูสถานะ<\/span>/);
    assert.match(card, /V1\.03/, "the version still shows");
    assert.match(repairCard(app.painted.html), /5 ยังไม่จบ/, "the repair card is not affected");
  }
  const zero = setup({ employee: mt, itwoVersion: "1.03", itwoSummary: { openCount: 0, badge: "", title: "" } });
  await zero.open("module=it-support");
  assert.match(workOrderCard(zero.painted.html), />0 ยังไม่จบ<\/span>/);
  assert.doesNotMatch(workOrderCard(zero.painted.html), /รอคุณ/);
});

test("module-office: a declared module is read only for a card the user may see (department list and test mode)", async () => {
  // แผนกที่จำกัด (ID) ไม่เห็นการ์ดใบสั่งงาน IT จึงไม่เรียกตัวประกาศของมันเลย
  let calls = 0;
  const restricted = setup({ employee: { ...mt, department: { code: "ID" } }, itwoVersion: "1.03", itwoSummary: { openCount: 1, badge: "", title: "" } });
  restricted.context.window.MNP_OFFICE_CARDS.IT_WORK_ORDER.loadCardSummary = async () => { calls += 1; return { openCount: 1 }; };
  await restricted.open("module=it-support");
  assert.doesNotMatch(restricted.painted.html, /ใบสั่งงาน IT/);
  assert.equal(count(restricted.painted.html, /request-type-version/g), 1, "only the repair card (which department ID may open) shows a version");
  assert.equal(calls, 0);
  // โหมดทดสอบ: ทั้งสองการ์ดยังเห็น และนับจากตัวประกาศของตัวเอง (ฐานข้อมูลแยกข้อมูลทดสอบ)
  const sandbox = setup({ employee: mt, sandbox: true, itwoVersion: "1.03", itwoSummary: { openCount: 2, badge: "", title: "" } });
  await sandbox.open("module=it-support");
  assert.match(workOrderCard(sandbox.painted.html), />2 ยังไม่จบ<\/span>/);
  assert.match(repairCard(sandbox.painted.html), />5 ยังไม่จบ<\/span>/);
  assert.deepEqual(sandbox.queries, []);
});

test("the stylesheet places the badge column at the top right of the card and styles the version as a solid, bordered badge", () => {
  const css = read("styles.css");
  assert.match(css, /\.request-type-side \{[^}]*flex-direction: column;[^}]*align-items: flex-end;/);
  assert.match(css, /\.request-type-top:has\(\.request-type-side\) \{ align-items: flex-start; \}/);
  const version = css.match(/\.request-type-version \{([^}]*)\}/)[1];
  assert.match(version, /color: var\(--mod-btn-ink\)/);
  assert.match(version, /background: var\(--mod-btn\)/);
  assert.match(version, /border: 1px solid var\(--mod-btn-edge\)/);
  assert.doesNotMatch(version, /opacity/, "no fading: it must be readable");
  assert.match(version, /font-size: var\(--text-meta\)/, "13px or larger on a phone");
});

test("the way for a new module to declare its card is written at the top of office-sections.js and in the README", () => {
  const source = read("modules/office-sections.js");
  assert.match(source, /MNP_OFFICE_CARDS/);
  assert.match(source, /openCount/);
  assert.match(read("README.md"), /MNP_OFFICE_CARDS/);
  assert.match(read("modules/module-itwo.js"), /MNP_OFFICE_CARDS \?\?= \{\}\)\.IT_WORK_ORDER/);
  assert.match(read("modules/module-itrp.js"), /MNP_OFFICE_CARDS \?\?= \{\}\)\.IT_COMPUTER_REPAIR/);
});
