import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โมดูลตรวจคุณภาพ (QA) #/qa · modules/qa-pages.js (โรงงาน ขั้น 5) — งาน QA ย้ายมาจาก RubberFlow (p=quality / spc / trace) และ #/st?lot= (กักกันวัตถุดิบ)
// หน้า: งานของฉัน · ผลตรวจ · NCR · CoA · SPC · สืบย้อนกลับ · วัตถุดิบที่กัก · สิทธิ์ใหม่: ปล่อยล็อตที่กัก / ตัดสินยางเส้นยาวที่กัก = หัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบเท่านั้น
// · ปลดกักกันวัตถุดิบ = หัวหน้า QA หรือหัวหน้า ST ขึ้นไป (RF_MATERIAL_RELEASE_HEAD_ONLY · หน้าวัตถุดิบที่กักชุดเดียวกับ #/st?tab=hold)
// (ฐานข้อมูลตัดสินจริง RF_QA_HEAD_ONLY / BOM_QA_HEAD_ONLY · หน้าจอซ่อนปุ่มเป็น UX) · ลิงก์เก่าของ RubberFlow พาไปแท็บเดียวกัน · แผนก RB ตอบ NCR ที่หน้า p=ncr ของ RubberFlow
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/qa-pages.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, id: `${dept}-${role}`, ...extra });
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const rowsOf = (html) => (html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1]?.split("<tr").slice(1) ?? [];

// ผู้ใช้ตามแผนก/ตำแหน่ง: พนักงาน QA · หัวหน้า QA (ผู้จัดการแผนก) · ผู้ช่วยผู้จัดการแผนก QA · ฝ่ายวางแผน · ผู้จัดการทั่วไป / ผู้จัดการโรงงาน / ผู้ช่วยผู้จัดการโรงงาน / admin
const STAFF = emp("QA", "staff");
const HEAD = emp("QA", "department_manager");
const PEOPLE = {
  heads: [HEAD, emp("QA", "assistant_department_manager"), emp("MGT", "general_manager"), emp("PP", "factory_manager"), emp("AD", "admin")],
  // the others that open the module (QA staff and planning; the QA assistant department manager is a head like the department manager) · and two heads of other departments that cannot release (they never open #/qa)
  others: [STAFF, emp("PP", "staff"), emp("PP", "department_manager"), emp("PP", "assistant_factory_manager")],
  elsewhere: [emp("RB", "department_manager"), emp("ST", "department_manager")],
};

function load({ employee = STAFF } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: "#/qa", toasts: [] };
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
    window: context, addEventListener() {}, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic(), addEventListener() {} },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  for (const file of FILES) vm.runInContext(read(file), context, { filename: file });
  const modules = context.MNP_REQUEST_MODULES;
  const rfApi = context.MNP_RUBBERFLOW_STORE;
  const bomApi = context.MNP_BOM_STORE;
  // ผู้ใช้จริงของหน้า (โหมดฐานข้อมูล): ตำแหน่งและแผนกของพนักงานตัดสินปุ่มและสิทธิ์ · คืน env เดิม
  const asDb = (employeeNext) => {
    context.state.employee = employeeNext;
    context.MNP_RUBBERFLOW.store.user = () => rfApi.personaUser(employeeNext);
    context.MNP_BOM.store.user = () => bomApi.personaUser(employeeNext);
    return env;
  };
  const open = async (query = "") => {
    log.hash = `#/qa${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await modules.FACTORY_QA.pages.qa(new URLSearchParams(query));
    return app.innerHTML;
  };
  const rfOpen = async (query) => {
    log.hash = `#/rubberflow?${query}`;
    app.innerHTML = "";
    await modules.RUBBERFLOW.pages.rubberflow(new URLSearchParams(query));
    return app.innerHTML;
  };
  const nav = () => {
    const item = modules.FACTORY_QA.nav[0];
    return [...item.subnav(item.path).matchAll(/<a class="rf-nav-item( is-active)?" href="([^"]*)"[^>]*>[\s\S]*?<span class="rf-nav-text">([^<]*)<\/span>(?:<span class="rf-nav-count"[^>]*>(\d+)<\/span>)?<\/a>/g)]
      .map((match) => ({ label: match[3], href: match[2], active: Boolean(match[1]), count: match[4] ? Number(match[4]) : 0 }));
  };
  const env = { context, app, log, fakes, root, modules, bom: context.MNP_BOM.store, rf: context.MNP_RUBBERFLOW, open, rfOpen, nav, asDb, rfApi, bomApi };
  context.MNP_BOM.store.setUser("B12");
  context.MNP_RUBBERFLOW.store.setUser("U09");
  return env;
}
const firstHeld = (env) => env.rf.store.data().lots.find((lot) => lot.qc === "hold");
const heldMaterial = (env) => env.rf.store.data().materialLots.find((lot) => lot.status === "hold");
const cardOf = (html, text) => cardsOf(html).find((card) => card.includes(text)) ?? "";

test("who opens #/qa: QA staff and head, PP and the managers; everyone else gets not found (menu and page, same gate)", async () => {
  const { modules } = load();
  const allowed = [STAFF, HEAD, emp("PP"), emp("AD", "admin"), emp("MGT", "general_manager"), emp("PP", "factory_manager"), emp("PP", "assistant_factory_manager")];
  const hidden = [emp("RB"), emp("RB", "department_manager"), emp("ST"), emp("SR"), emp("WH"), emp("GR"), emp("ID"), emp("HR"), { ...STAFF, isSandbox: false }];
  for (const employee of allowed) assert.equal(modules.FACTORY_QA.navAllowed(employee), true, JSON.stringify(employee));
  for (const employee of hidden) assert.equal(modules.FACTORY_QA.navAllowed(employee), false, JSON.stringify(employee));
  for (const employee of hidden.filter((row) => row.isSandbox)) {
    const env = load({ employee });
    await env.open("");
    assert.equal(env.log.notFound, 1, `${JSON.stringify(employee)} is refused`);
  }
  // QA is no guest anywhere else: #/st has no QA mode any more
  assert.equal(load().context.MNP_ST_PAGES.guest(STAFF), null);
  assert.equal(load().context.MNP_ST_PAGES.access(HEAD), null);
});

test("the QA-head rule is one definition for the page, the RubberFlow actions and the BOM decision: QA head and assistant head, general manager, factory manager and admin; never staff, planning, another department head or the assistant factory manager", () => {
  const env = load();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const bomActions = env.context.MNP_BOM_ACTIONS;
  for (const employee of PEOPLE.heads) {
    const rf = env.rfApi.personaUser(employee);
    const bom = env.bomApi.personaUser(employee);
    assert.equal(rules.canQaRelease(rf), true, `${employee.role.code} ${employee.department.code} (RubberFlow user)`);
    assert.equal(rules.canQaRelease(bom), true, `${employee.role.code} ${employee.department.code} (BOM user)`);
    assert.equal(env.rfApi.can(rf, "qaRelease"), true);
    assert.equal(bomActions.helpers.canDecideRods(bom), true);
  }
  for (const employee of [...PEOPLE.others, ...PEOPLE.elsewhere]) {
    const rf = env.rfApi.personaUser(employee);
    const bom = env.bomApi.personaUser(employee);
    assert.equal(rules.canQaRelease(rf) || rules.canQaRelease(bom), false, `${employee.role.code} ${employee.department.code}`);
    assert.equal(env.rfApi.can(rf, "qaRelease"), false);
    assert.equal(bomActions.helpers.canDecideRods(bom), false);
  }
  // the rest of QA's work stays open to staff and planning: record results, hold, open / close NCR, hold chemicals; the rod holds are still listed for them
  for (const employee of [STAFF, emp("PP", "staff")]) {
    const rf = env.rfApi.personaUser(employee);
    assert.equal(env.rfApi.can(rf, "qcDecision"), true);
    assert.equal(env.rfApi.can(rf, "holdMaterial"), true);
    assert.equal(bomActions.helpers.canSeeRodHolds(env.bomApi.personaUser(employee)), true);
  }
  assert.equal(env.rfApi.can(env.rfApi.personaUser(emp("QA", "staff")), "skipRest"), true, "skip ageing stays with QA members");
  assert.equal(env.rfApi.can(env.rfApi.personaUser(emp("RB", "department_manager")), "skipRest"), true, "and the RB head");
  // the Thai refusal for the two database codes
  for (const code of ["RF_QA_HEAD_ONLY", "BOM_QA_HEAD_ONLY"]) {
    const error = env.rfApi.mapRemoteError({ code, message: code });
    assert.equal(error.code, code);
    assert.match(error.message, /เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ/);
  }
  // releasing a held chemical lot is wider (owner order 2026-11-24): every QA head plus the ST head (manager or assistant manager); never QA / ST staff, planning or the RB head
  // the other two head-only decisions stay with the QA head: the ST head neither releases a line lot nor decides a rod lot
  const releases = (employee) => rules.canReleaseMaterial(env.rfApi.personaUser(employee)) && env.rfApi.can(env.rfApi.personaUser(employee), "releaseMaterial");
  for (const employee of [...PEOPLE.heads, emp("ST", "department_manager"), emp("ST", "assistant_department_manager")]) assert.equal(releases(employee), true, `${employee.role.code} ${employee.department.code} releases chemicals`);
  for (const employee of [...PEOPLE.others, emp("ST", "staff"), emp("RB", "department_manager"), emp("PK", "department_manager")]) assert.equal(env.rfApi.can(env.rfApi.personaUser(employee), "releaseMaterial"), false, `${employee.role.code} ${employee.department.code} does not`);
  const stHead = emp("ST", "assistant_department_manager");
  assert.equal(env.rfApi.can(env.rfApi.personaUser(stHead), "qaRelease") || bomActions.helpers.canDecideRods(env.bomApi.personaUser(stHead)), false, "the ST head stays out of the QA-head decisions");
  const refusal = env.rfApi.mapRemoteError({ code: "RF_MATERIAL_RELEASE_HEAD_ONLY", message: "RF_MATERIAL_RELEASE_HEAD_ONLY" });
  assert.equal(refusal.message, "ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ");
  assert.equal(rules.MATERIAL_RELEASE_TEXT, refusal.message, "the page and the refusal say the same rule");
});

test("งานของฉัน: the page opens on it; staff and planning see a held line lot as a re-check (hold only), the head sees the decide button; the chemical release is the head's", async () => {
  const env = load();
  const lot = firstHeld(env);
  const material = heldMaterial(env);
  assert.ok(lot && material, "the demo seed holds a line lot and a chemical lot");
  const lotTitle = `ตัดสินล็อต ${lot.id}`;
  const materialTitle = `ปลดกักกันล็อต ${material.lotNo}`;
  for (const employee of PEOPLE.others) {
    const html = await env.asDb(employee).open("");
    assert.equal(h1Of(html), "งานของฉัน");
    const lotCard = cardOf(html, lotTitle);
    assert.match(lotCard, /data-rf-open="qcRecord"[^>]*>ตรวจซ้ำ \(กักต่อ\)</, `${employee.role.code} ${employee.department.code} re-checks`);
    assert.doesNotMatch(lotCard, />ตัดสิน</);
    // the head-only sentence is not repeated on the card: it sits once under the group heading and in the title of the button they do see
    assert.doesNotMatch(lotCard.replace(/ (title|aria-label)="[^"]*"/g, ""), /เฉพาะหัวหน้า QA/, "no sentence on the lot card");
    assert.match(lotCard, /<button [^>]*title="ปล่อยหรือตัดสินผ่าน\/ไม่ผ่านได้เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ"/, "the re-check button explains itself");
    assert.match(lotCard, /aria-label="ตรวจซ้ำล็อต [^"]*เฉพาะหัวหน้า QA/);
    const materialCard = cardOf(html, materialTitle);
    assert.doesNotMatch(materialCard, /data-rf-action="setMaterialLotStatus"/, "no release button");
    assert.doesNotMatch(materialCard, /เฉพาะหัวหน้า QA/, "no sentence on the chemical card");
    const sentences = html.match(/<p class="small muted">[^<]*เฉพาะหัวหน้า QA[^<]*<\/p>/g) ?? [];
    assert.equal(sentences.filter((text) => text.includes("ปล่อยหรือตัดสินผ่าน/ไม่ผ่านได้")).length, 1, "the lots group says it once under its heading");
    assert.equal(sentences.filter((text) => text.includes("ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ")).length, 1, "the chemicals group says it once under its heading (the ST head may release too)");
    assert.equal(new Set(sentences).size, sentences.length, "no sentence twice on the page");
  }
  for (const employee of PEOPLE.heads) {
    const html = await env.asDb(employee).open("");
    assert.match(cardOf(html, lotTitle), /data-rf-open="qcRecord"[^>]*>ตัดสิน</, `${employee.role.code} ${employee.department.code} decides`);
    assert.doesNotMatch(cardOf(html, lotTitle), /ตรวจซ้ำ|เฉพาะหัวหน้า QA/);
    const release = cardOf(html, materialTitle);
    assert.match(release, /data-rf-right="releaseMaterial"[^>]*data-rf-action="setMaterialLotStatus"|data-rf-action="setMaterialLotStatus"[^>]*data-rf-right="releaseMaterial"/);
    assert.match(release, />ปลดกักกัน</);
    assert.equal(JSON.parse(release.match(/data-rf-args="([^"]*)"/)[1].replaceAll("&quot;", '"')).status, "available");
  }
  // every card is a card of this page only: the head reaches the same list, nothing is repeated, wording is ยางเส้นยาว
  const html = await env.asDb(HEAD).open("");
  assert.doesNotMatch(html, /แท่ง|undefined|NaN|\[object Object\]/);
  assert.equal(new Set(cardsOf(html)).size, cardsOf(html).length, "no card twice");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
});

// โรงงานขั้น 6: QA เปิดหน้า RubberFlow ไม่ได้แล้ว สิทธิ์ข้ามเวลาบ่มที่ QA มีอยู่ (DB: หัวหน้า RB หรือแผนก QA) จึงมีที่ "งานของฉัน" ของโมดูลนี้ด้วย · dialog / คำสั่ง / สิทธิ์ชุดเดียวกับหน้าผสมของ RubberFlow
test("งานของฉัน: QA members skip the ageing of a resting mixing lot here with the same RubberFlow dialog and right; accounts without the right, and ST / WH, do not get it", async () => {
  const env = load();
  const resting = env.rf.store.data().lots.find((lot) => lot.stage === "mixing" && lot.readyAt > Date.now());
  assert.ok(resting, "the demo has a batch that is still resting");
  const groupOf = (html) => html.split('<h2 class="bom-h3">').find((part) => part.startsWith("ล็อตผสมที่กำลังบ่ม")) ?? "";
  for (const employee of [STAFF, HEAD]) {
    const html = await env.asDb(employee).open("");
    const group = groupOf(html);
    assert.ok(group, `${employee.role.code}: the resting lots are listed`);
    assert.match(group, /data-rf-scope="rubberflow"|<div class="bom-job-grid">/);
    const card = cardOf(html, resting.id);
    assert.match(card, new RegExp(`data-rf-open="skipRest"[^>]*>ข้ามเวลาบ่ม<`), "the button opens the RubberFlow dialog");
    assert.equal(JSON.parse(card.match(/data-rf-args="([^"]*)"/)[1].replaceAll("&quot;", '"')).lotId, resting.id);
    assert.match(html, /<div data-rf-scope="rubberflow"><h2 class="bom-h3">ล็อตผสมที่กำลังบ่ม/, "inside the scope that RubberFlow's binder owns");
    // the dialog is the one the RubberFlow mixing page uses, built with the same context and asking for a reason
    const dialog = env.context.MNP_RUBBERFLOW_DIALOGS.skipRest(env.rf.context(new URLSearchParams()), { lotId: resting.id });
    assert.match(dialog.html, /data-rf-form="endRest"/);
    assert.match(dialog.html, /name="reason"[^>]*required|required[^>]*name="reason"/);
  }
  env.asDb(STAFF);
  // the group stays when it is the only thing on the page (no empty-state line next to it)
  const quiet = env.rf.store.data();
  quiet.lots.forEach((lot) => { if (lot.qc === "hold") lot.qc = "pass"; });
  quiet.ncrs.forEach((ncr) => { ncr.status = "closed"; });
  quiet.materialLots.forEach((lot) => { if (lot.status === "hold") lot.status = "available"; });
  const onlyResting = await env.open("");
  assert.ok(groupOf(onlyResting) && !onlyResting.includes("ไม่มีงานค้าง"));
  // no resting lot = no group
  quiet.lots.forEach((lot) => { lot.readyAt = 0; });
  assert.equal(groupOf(await env.asDb(STAFF).open("")), "", "nothing resting: the group is not drawn");
  // deny: the planning group opens #/qa but has no skip right (DB: RB head or QA); ST / WH staff do not open #/qa at all
  const fresh = load();
  assert.equal(groupOf(await fresh.asDb(emp("PP", "staff")).open("")), "", "planning staff cannot skip the rest time");
  for (const employee of [emp("ST", "staff"), emp("WH", "staff"), emp("ST", "department_manager"), emp("WH", "department_manager")]) {
    fresh.asDb(employee);
    fresh.log.notFound = 0;
    assert.equal(await fresh.open(""), "<notfound></notfound>", `${employee.department.code} ${employee.role.code} has no QA page, so no skip button`);
  }
});

test("ผลตรวจ: the newest record is first (by tested time, then number), whatever order the store holds them in; the search keeps that order", async () => {
  const env = load();
  const data = env.rf.store.data();
  const template = data.qcRecords[0];
  data.qcRecords.splice(0, data.qcRecords.length, ...[3, 1, 5, 2, 4].map((n) => ({ ...structuredClone(template), id: `QC-ORD-${n}`, lotId: `LOT-ORD-${n}`, at: 1_700_000_000_000 + (n === 4 ? 3 : n) * 1000 })));
  const html = await env.asDb(STAFF).open("tab=records");
  const ids = rowsOf(html).map((row) => row.match(/QC-ORD-\d/)[0]);
  assert.deepEqual(ids, ["QC-ORD-5", "QC-ORD-4", "QC-ORD-3", "QC-ORD-2", "QC-ORD-1"], "newest time first; equal time = higher number first");
  const filtered = await env.open("tab=records&q=QC-ORD");
  assert.deepEqual(rowsOf(filtered).map((row) => row.match(/QC-ORD-\d/)[0]), ids);
  assert.deepEqual([...data.qcRecords.map((record) => record.id)], ["QC-ORD-3", "QC-ORD-1", "QC-ORD-5", "QC-ORD-2", "QC-ORD-4"], "the store itself is not reordered");
});

test("งานของฉัน: each source shows at most six cards and says how many more with one link; the rest opens with ?all=1", async () => {
  const env = load({ employee: HEAD }).asDb(HEAD);
  const data = env.rf.store.data();
  const template = data.lots.find((lot) => lot.qc === "hold");
  for (let i = 0; i < 9; i += 1) data.lots.unshift({ ...structuredClone(template), id: `EX-MANY-${String(i).padStart(2, "0")}`, createdAt: Date.now() + i });
  const held = data.lots.filter((lot) => lot.qc === "hold").length;
  assert.ok(held > 6);
  const html = await env.open("");
  assert.equal(cardsOf(html).filter((card) => /ตัดสินล็อต /.test(card)).length, 6);
  assert.match(html, new RegExp(`อีก ${held - 6} รายการ`));
  assert.equal((html.match(/แสดงทั้งหมด/g) ?? []).length, 1);
  const all = await env.open("all=1");
  assert.equal(cardsOf(all).filter((card) => /ตัดสินล็อต /.test(card)).length, held);
  assert.doesNotMatch(all, /แสดงทั้งหมด/);
  assert.equal(env.nav()[0].count, cardsOf(all).filter((card) => !/กำลังบ่มยาง/.test(card)).length, "the menu counts every waiting card, shown or not (a resting lot is not work waiting)");
});

test("qcRecord dialog: a held lot offers a QA staff only 'hold / re-check'; the head (and any lot that is not held) gets every result; changing the lot re-checks it", async () => {
  const env = load();
  const held = firstHeld(env);
  const free = env.rf.store.data().lots.find((lot) => lot.qc === "pass");
  const optionOf = (html, value) => (html.slice(html.indexOf('name="result"')).match(new RegExp(`<option value="${value}"[^>]*>`)) ?? [""])[0];
  const build = (employee, lotId) => { env.asDb(employee); return env.context.MNP_RUBBERFLOW_DIALOGS.qcRecord(env.rf.context(new URLSearchParams()), { lotId }); };
  for (const employee of [...PEOPLE.others, ...PEOPLE.elsewhere]) {
    const built = build(employee, held.id);
    for (const value of ["", "pass", "fail"]) assert.match(optionOf(built.html, value), /disabled/, `${employee.department.code}: '${value}' is closed on a held lot`);
    assert.doesNotMatch(optionOf(built.html, "hold"), /disabled/);
    assert.match(optionOf(built.html, "hold"), /selected/, "hold is the chosen result");
    assert.doesNotMatch(built.html, /data-qc-head-only hidden/, "the one-line reason is shown");
    assert.match(built.html, /เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ/);
    // a lot that is not held: everything is open
    const open = build(employee, free.id);
    for (const value of ["", "pass", "hold", "fail"]) assert.doesNotMatch(optionOf(open.html, value), /disabled/, `${value} on a lot that is not held`);
  }
  for (const employee of PEOPLE.heads) {
    const built = build(employee, held.id);
    for (const value of ["", "pass", "hold", "fail"]) assert.doesNotMatch(optionOf(built.html, value), /disabled/, `${employee.role.code}: ${value}`);
    assert.match(built.html, /data-qc-head-only hidden/);
  }
  // choosing another lot in the open dialog: the options follow the chosen lot
  const built = build(STAFF, free.id);
  const lotSelect = { value: free.id, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const resultSelect = { value: "", options: ["", "pass", "hold", "fail"].map((value) => ({ value, disabled: false })), get selectedOptions() { return [this.options.find((option) => option.value === this.value)]; } };
  const note = { hidden: true };
  const dialog = { querySelector: (selector) => (selector === "[data-qc-lot]" ? lotSelect : selector === "[data-qc-result]" ? resultSelect : selector === "[data-qc-head-only]" ? note : null) };
  built.bind(dialog);
  assert.deepEqual(resultSelect.options.map((option) => option.disabled), [false, false, false, false]);
  lotSelect.value = held.id;
  lotSelect.handlers.change();
  assert.deepEqual(resultSelect.options.map((option) => option.disabled), [true, true, false, true], "a held lot closes everything but hold");
  assert.equal(resultSelect.value, "hold");
  assert.equal(note.hidden, false);
  lotSelect.value = free.id;
  lotSelect.handlers.change();
  assert.deepEqual(resultSelect.options.map((option) => option.disabled), [false, false, false, false]);
  assert.equal(note.hidden, true);
});

test("the client mirrors the database on the actions: staff and planning hold a held lot again, only the head releases or fails it; releasing a held chemical lot is the QA or ST head's, holding stays with ST, QA and planning", () => {
  const env = load();
  const A = env.context.MNP_RUBBERFLOW_ACTIONS;
  const base = structuredClone(env.rf.store.data());
  const held = base.lots.find((lot) => lot.qc === "hold");
  const free = base.lots.find((lot) => lot.qc === "pass");
  const heldMaterialLot = base.materialLots.find((lot) => lot.status === "hold");
  const availableMaterial = base.materialLots.find((lot) => lot.status !== "hold" && lot.qtyKg > 0);
  const ctxOf = (employee) => ({ now: Date.now(), remote: true, user: env.rfApi.personaUser(employee) });
  const record = (employee, lotId, result) => A.addQcRecord(structuredClone(base), { lotId, values: { hardness: 65 }, result }, ctxOf(employee));
  const release = (employee) => A.setMaterialLotStatus(structuredClone(base), { lotNo: heldMaterialLot.lotNo, status: "available" }, ctxOf(employee));
  const refused = (fn) => assert.throws(fn, (error) => { assert.match(error.message, /เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ/); return true; });
  const refusedRelease = (fn) => assert.throws(fn, (error) => { assert.match(error.message, /ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน\/ผู้ดูแลระบบ/); return true; });
  for (const employee of PEOPLE.others) {
    // a held lot: hold (re-check) is open to staff, planning and the RB head; pass and fail are the head's
    if (employee.department.code === "QA" || employee.department.code === "PP" || employee.department.code === "RB") assert.doesNotThrow(() => record(employee, held.id, "hold"), `${employee.department.code}/${employee.role.code} may hold again`);
    if (env.rfApi.can(env.rfApi.personaUser(employee), "qcDecision")) {
      refused(() => record(employee, held.id, "pass"));
      refused(() => record(employee, held.id, "fail"));
      assert.doesNotThrow(() => record(employee, free.id, "pass"), "a lot that is not held is any QA member's to record");
    }
    refusedRelease(() => release(employee));
    if (env.rfApi.can(env.rfApi.personaUser(employee), "holdMaterial")) assert.doesNotThrow(() => A.setMaterialLotStatus(structuredClone(base), { lotNo: availableMaterial.lotNo, status: "hold" }, ctxOf(employee)), "holding a chemical lot stays open to ST, QA and planning");
  }
  for (const employee of PEOPLE.heads) {
    assert.doesNotThrow(() => record(employee, held.id, "pass"), `${employee.role.code} releases`);
    assert.doesNotThrow(() => record(employee, held.id, "fail"));
    assert.doesNotThrow(() => release(employee));
  }
  // ST staff hold but cannot release; the ST head (manager or assistant manager) releases a held chemical lot but still cannot release or fail a held line lot
  assert.doesNotThrow(() => A.setMaterialLotStatus(structuredClone(base), { lotNo: availableMaterial.lotNo, status: "hold" }, ctxOf(emp("ST", "staff"))));
  refusedRelease(() => release(emp("ST", "staff")));
  for (const head of [emp("ST", "department_manager"), emp("ST", "assistant_department_manager")]) {
    assert.doesNotThrow(() => release(head), `${head.role.code} ST releases a chemical lot`);
    assert.throws(() => record(head, held.id, "pass"), `${head.role.code} ST releases no line lot`);
  }
  refusedRelease(() => release(emp("RB", "department_manager")));
  // the page and the demo store (no rights in the demo) are unchanged
  assert.doesNotThrow(() => A.addQcRecord(structuredClone(base), { lotId: held.id, values: { hardness: 65 }, result: "pass" }, { now: Date.now(), user: { name: "demo" } }));
  assert.match(read("modules/bom-actions.js"), /canDecideRods = \(user\) => Boolean\(root\.MNP_RUBBERFLOW_RULES\?\.canQaRelease\?\.\(user\)\)/, "BOM decides with the same helper");
});

test("วัตถุดิบที่กัก: held chemical lots with the release for the heads only (the same page as #/st?tab=hold), and a search that finds available lots to put on hold", async () => {
  const env = load();
  const material = heldMaterial(env);
  const available = env.rf.store.data().materialLots.find((lot) => lot.status !== "hold" && lot.qtyKg > 0);
  for (const employee of PEOPLE.others) {
    const html = await env.asDb(employee).open("tab=material");
    assert.equal(h1Of(html), "วัตถุดิบที่กัก");
    assert.ok(html.includes(escapeHtml(material.lotNo)), "the held lot is listed");
    assert.doesNotMatch(html, /data-rf-action="setMaterialLotStatus"[^>]*>ปลดกักกัน</, `${employee.role.code} ${employee.department.code} cannot release`);
    assert.equal(html.split("ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ").length - 1, 1, "the release rule is said once");
    const found = await env.open(`tab=material&q=${encodeURIComponent(available.lotNo)}`);
    assert.match(found, /data-rf-action="setMaterialLotStatus"[^>]*>กักกัน</, "the hold button on an available lot (QA, ST and planning hold)");
    assert.equal(JSON.parse(found.match(/data-rf-action="setMaterialLotStatus"[^>]*data-rf-args="([^"]*)"|data-rf-args="([^"]*)"[^>]*data-rf-action="setMaterialLotStatus"/).slice(1).find(Boolean).replaceAll("&quot;", '"')).status, "hold");
  }
  for (const employee of PEOPLE.heads) {
    const html = await env.asDb(employee).open("tab=material");
    assert.match(html, /data-rf-right="releaseMaterial"/);
    assert.match(html, />ปลดกักกัน</);
    assert.ok(!html.includes("ปลดกักกันวัตถุดิบได้เฉพาะ"), "no rule sentence for a head");
    assert.doesNotMatch(html, /แท่ง|undefined|NaN/);
  }
  // no search = no long list of usable lots; a search with no hit says so
  const plainPage = await env.asDb(STAFF).open("tab=material");
  assert.doesNotMatch(plainPage, />กักกัน</, "no hold button without a search");
  assert.match(await env.open("tab=material&q=NO-SUCH-LOT"), /ไม่พบล็อตที่ใช้ได้ตามคำค้น/);
  // a lot already on hold is not offered to hold again
  assert.doesNotMatch(await env.open(`tab=material&q=${encodeURIComponent(material.lotNo)}`), /data-rf-action="setMaterialLotStatus"[^>]*>กักกัน</);
});

test("ผลตรวจ: every QC record with search, and the record button for those who decide; the page and its dialog are the RubberFlow ones", async () => {
  const env = load();
  const records = env.rf.store.data().qcRecords;
  assert.ok(records.length > 0, "the demo seed has QC records");
  const html = await env.asDb(STAFF).open("tab=records");
  assert.equal(h1Of(html), "ผลตรวจ");
  assert.equal(rowsOf(html).length, records.length);
  for (const record of records) assert.ok(html.includes(escapeHtml(record.id)), record.id);
  assert.match(html, /data-rf-open="qcRecord"[^>]*>บันทึกผลตรวจ</);
  assert.match(html, /data-rf-scope="rubberflow"/);
  const one = records[0];
  const filtered = await env.open(`tab=records&q=${encodeURIComponent(one.id)}`);
  assert.deepEqual(rowsOf(filtered).length, records.filter((record) => `${record.id} ${record.lotId} ${record.inspector ?? ""} ${record.note ?? ""}`.toLowerCase().includes(one.id.toLowerCase())).length);
  assert.match(filtered, /ล้างตัวกรอง/);
  assert.doesNotMatch(html, /#\/rubberflow\?p=/, "no link to the old RubberFlow pages");
  // a member of the planning group records too; the record dialog exists in the RubberFlow registry
  assert.match(await env.asDb(emp("PP", "staff")).open("tab=records"), /data-rf-open="qcRecord"/);
  assert.equal(typeof env.context.MNP_RUBBERFLOW_DIALOGS.qcRecord, "function");
});

test("NCR: RubberFlow's own NCR list (not the NCR/CAR request module) with open, answer and close; QA staff and head close, a planner reads the same cards", async () => {
  const env = load();
  const open = env.rf.store.data().ncrs.find((ncr) => ncr.status === "open");
  assert.ok(open, "the demo seed has an open NCR");
  for (const employee of [STAFF, HEAD, emp("PP", "staff")]) {
    const html = await env.asDb(employee).open("tab=ncr");
    assert.equal(h1Of(html), "NCR");
    assert.ok(html.includes(escapeHtml(open.id)));
    assert.match(html, /data-rf-open="ncr"[^>]*>เปิด NCR</, "the open button");
    assert.match(html, /data-rf-form="closeNcr"/, "the close form");
    assert.match(html, /data-rf-form="updateNcr"/);
    assert.match(html, /วิเคราะห์ทำไม 5 ครั้ง/);
  }
  assert.doesNotMatch(await env.asDb(STAFF).open("tab=ncr"), /#\/ncr\?|NCR\/CAR/, "no copy of the request module here");
  // the open NCRs also stand as cards on งานของฉัน, each with one link to this tab
  const work = await env.open("");
  assert.match(cardOf(work, open.id), /href="#\/qa\?tab=ncr"/);
});

test("CoA: the finishing lots with the CoA dialog button (the print stays as it was); ?lot= narrows to one lot with a link back; search narrows by lot, order or customer", async () => {
  const env = load();
  const finishing = env.rf.store.data().lots.filter((lot) => lot.stage === "finishing");
  assert.ok(finishing.length >= 2);
  const html = await env.asDb(STAFF).open("tab=coa");
  assert.equal(h1Of(html), "CoA");
  assert.equal(rowsOf(html).length, finishing.length);
  assert.equal([...html.matchAll(/data-rf-open="coa"/g)].length, finishing.length);
  const one = finishing[0];
  const narrowed = await env.open(`tab=coa&lot=${encodeURIComponent(one.id)}`);
  assert.equal(rowsOf(narrowed).length, 1);
  assert.ok(narrowed.includes(escapeHtml(one.id)));
  assert.match(narrowed, /href="#\/qa\?tab=coa"[^>]*>ดูทุกล็อต</);
  const missing = await env.open("tab=coa&lot=FN-NOPE");
  assert.match(missing, /ไม่พบล็อตสินค้าสำเร็จรูปนี้/);
  const bySearch = await env.open(`tab=coa&q=${encodeURIComponent(one.id.toLowerCase())}`);
  assert.equal(rowsOf(bySearch).length, 1);
  // the print dialog itself is the RubberFlow one (one implementation, no numbering or history)
  const dialog = env.context.MNP_RUBBERFLOW_DIALOGS.coa(env.rf.context(new URLSearchParams()), { lotId: one.id });
  assert.match(dialog.html, /CERTIFICATE OF ANALYSIS/);
});

test("SPC: the chart picker and the charts of the RubberFlow view; ?ch= selects one; picking another sends the page to #/qa with that value", async () => {
  const env = load();
  const first = await env.asDb(STAFF).open("tab=spc");
  assert.equal(h1Of(first), "SPC");
  assert.match(first, /rf-spc-chart/);
  assert.match(first, /<option value="ex\.thickness\.RC-EPDM-DS01" selected>/, "the first value is the Door Seal thickness");
  const cu = await env.open("tab=spc&ch=cu.temp");
  assert.match(cu, /<option value="cu\.temp" selected>/);
  assert.match(cu, /แผนภูมิควบคุม · อบ · อุณหภูมิอบ/);
  assert.equal(env.nav().find((item) => item.active)?.label, "SPC");
  // the select of the header changes the page (the binder is the page's own)
  const select = { handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const form = { handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-rf-ch]"] = [select];
  env.fakes["[data-rf-pick]"] = [form];
  await env.open("tab=spc&ch=cu.temp");
  select.handlers.change({ target: { value: "lab.hardness" } });
  assert.equal(env.log.hash, "#/qa?tab=spc&ch=lab.hardness");
  let prevented = false;
  form.handlers.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("สืบย้อนกลับ: search by box, lot or material lot with the trees of the RubberFlow view; the search form and sample links stay in #/qa", async () => {
  const env = load();
  const data = env.rf.store.data();
  const box = data.fgBoxes.find((row) => row.status === "in_stock") ?? data.fgBoxes[0];
  const empty = await env.asDb(STAFF).open("tab=trace");
  assert.equal(h1Of(empty), "สืบย้อนกลับ");
  assert.match(empty, /data-rf-search/);
  assert.match(empty, /href="#\/qa\?tab=trace&amp;q=/, "the samples stay in this module");
  assert.doesNotMatch(empty, /#\/rubberflow\?p=trace/);
  const hit = await env.open(`tab=trace&q=${encodeURIComponent(box.id)}`);
  assert.match(hit, /ย้อนกลับไปต้นทาง/);
  assert.match(hit, /rf-node is-hit/);
  assert.match(await env.open("tab=trace&q=NOT-A-CODE"), /ไม่พบรหัส/);
  const lot = data.materialLots[0];
  assert.match(await env.open(`tab=trace&q=${encodeURIComponent(lot.lotNo)}`), /ไปข้างหน้า \(ใช้ที่ไหนบ้าง\)/);
  // the scan dialog of RubberFlow sends a lot code to this tab (the roles that open #/qa) · a box goes to the warehouse module (step 6), so a QA account gets no trace link for a box
  const scan = env.context.MNP_RUBBERFLOW_DIALOGS.scan(env.rf.context(new URLSearchParams()), { code: data.lots[0].id });
  assert.ok(scan.html.includes(`#/qa?tab=trace&amp;q=${data.lots[0].id}`), "scan → trace in #/qa");
  const boxScan = env.context.MNP_RUBBERFLOW_DIALOGS.scan(env.rf.context(new URLSearchParams()), { code: box.id });
  assert.ok(!boxScan.html.includes("#/qa?tab=trace"), "a box is the warehouse's: no trace link from the box scan");
});

test("one link each to the QC inspection sheets (#/qc) and the NCR/CAR requests (#/ncr) on งานของฉัน, only to a module the user may open; no copy of their screens", async () => {
  const env = load();
  env.context.MNP_REQUEST_MODULES.QC = { enabled: true, navAllowed: () => true };
  env.context.MNP_REQUEST_MODULES.NCR_CAR = { enabled: true, navAllowed: () => true };
  const html = await env.asDb(STAFF).open("");
  assert.equal([...html.matchAll(/href="#\/qc"/g)].length, 1);
  assert.equal([...html.matchAll(/href="#\/ncr"/g)].length, 1);
  assert.match(html, />ใบตรวจ QC</);
  assert.match(html, />NCR\/CAR \(ใบคำร้อง\)</);
  for (const tab of ["records", "ncr", "coa", "spc", "trace", "material"]) assert.doesNotMatch(await env.open(`tab=${tab}`), /href="#\/qc"|href="#\/ncr"/, `${tab} repeats no link`);
  env.context.MNP_REQUEST_MODULES.NCR_CAR.navAllowed = () => false;
  const none = await env.open("");
  assert.doesNotMatch(none, /href="#\/ncr"/, "a module the account cannot open gets no link");
  assert.equal([...none.matchAll(/href="#\/qc"/g)].length, 1);
  delete env.context.MNP_REQUEST_MODULES.QC;
  assert.doesNotMatch(await env.open(""), /href="#\/qc"/, "a module that is not loaded gets no link");
});

test("the RubberFlow parts are bound by RubberFlow's own binder with a context whose page links point at #/qa; a save there repaints #/qa", async () => {
  const env = load();
  const calls = [];
  env.context.MNP_RUBBERFLOW_BIND = (slot, ctx) => calls.push([slot, ctx]);
  const slot = { id: "slot" };
  env.fakes["[data-rf-scope]"] = [slot];
  await env.asDb(STAFF).open("");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], slot);
  assert.equal(calls[0][1].pageUrl({ tab: "ncr" }), "#/qa?tab=ncr", "the RubberFlow context links stay in this module");
  assert.equal(typeof calls[0][1].can, "function");
  // the RubberFlow store repaints #/qa (and #/wh, #/st) after a save
  assert.match(read("modules/module-rubberflow.js"), /\["wh", "st", "qa"\]\.includes\(currentRoute\(\)\.path\)/);
  // while RubberFlow loads or failed the page says so once and the BOM part still shows
  const rf = env.rf.store;
  rf.isRemote = () => true;
  rf.status = () => "error";
  rf.error = () => ({ message: "เชื่อมต่อไม่ได้" });
  const failed = await env.open("");
  assert.equal([...failed.matchAll(/โหลดข้อมูล RubberFlow ไม่สำเร็จ/g)].length, 1);
  for (const tab of ["records", "ncr", "coa", "spc", "trace", "material"]) assert.equal([...(await env.open(`tab=${tab}`)).matchAll(/โหลดข้อมูล RubberFlow ไม่สำเร็จ/g)].length, 1, tab);
});

test("the old RubberFlow quality, spc and trace links go to the matching #/qa tab for QA, planning and managers; RB gets one line and the NCR page for RB answers", async () => {
  const env = load();
  const goes = [["p=quality", "#/qa"], ["p=quality&tab=records", "#/qa?tab=records"], ["p=quality&tab=ncr", "#/qa?tab=ncr"], ["p=quality&tab=coa", "#/qa?tab=coa"], ["p=spc&ch=cu.temp", "#/qa?tab=spc&ch=cu.temp"], ["p=trace&q=FN-1", "#/qa?tab=trace&q=FN-1"]];
  for (const employee of [STAFF, HEAD, emp("PP", "staff"), emp("AD", "admin"), emp("PP", "factory_manager")]) {
    env.asDb(employee);
    for (const [query, target] of goes) {
      assert.equal(await env.rfOpen(query), "", `${employee.department.code}/${employee.role.code} ${query}`);
      assert.equal(env.log.hash, target);
    }
  }
  // RB (any role) cannot open #/qa: one line, no table, no form, no second copy
  for (const employee of [emp("RB", "staff"), emp("RB", "department_manager")]) {
    env.asDb(employee);
    for (const [query] of goes) {
      const html = await env.rfOpen(query);
      assert.match(html, /อยู่ที่โมดูลตรวจคุณภาพ \(QA\)/);
      assert.doesNotMatch(html, /<table|data-rf-form|data-rf-open="qcRecord"/);
      assert.equal(env.log.hash, `#/rubberflow?${query}`);
    }
  }
  // RubberFlow's menu has no QA entries any more; RB and planning see "NCR ที่ RB ต้องตอบ" with the open count
  const open = env.rf.store.data().ncrs.filter((ncr) => ncr.status === "open").length;
  assert.ok(open >= 1);
  for (const employee of [emp("RB", "staff"), emp("RB", "department_manager"), emp("PP", "staff"), STAFF]) {
    env.asDb(employee);
    const item = env.modules.RUBBERFLOW.nav[0];
    await env.rfOpen("p=dashboard");
    const menu = item.subnav("rubberflow");
    assert.doesNotMatch(menu, /p=quality|p=spc|p=trace|QC · NCR · CoA|SPC \/ Cpk/);
    const answers = employee.department.code !== "QA";
    assert.equal(/p=ncr/.test(menu), answers, `${employee.department.code} ${employee.role.code} menu`);
    if (answers) assert.equal(Number(menu.match(/p=ncr"[^>]*>[\s\S]*?<span class="rf-nav-count"[^>]*>(\d+)</)?.[1]), open);
  }
  env.asDb(emp("RB", "staff"));
  const answer = await env.rfOpen("p=ncr");
  assert.match(answer, /<h1>NCR ที่ RB ต้องตอบ<\/h1>/);
  assert.match(answer, /data-rf-form="updateNcr"/);
  assert.doesNotMatch(answer, /data-rf-form="closeNcr"|data-rf-open="ncr"|data-rf-open="qcRecord"/, "RB answers; QA opens and closes");
  assert.doesNotMatch(answer, /undefined|NaN/);
  // QA's own account does not use that page (it works in #/qa)
  env.asDb(STAFF);
  assert.equal(await env.rfOpen("p=ncr"), "<notfound></notfound>", "QA's own account does not open RubberFlow any more (step 6)");
});

test("finishing page: RB reads the QC badge and hold reasons but has no CoA button; QA, planning and managers get a link to the CoA of the lot in #/qa; skip ageing stays on the line page for the RB head and QA", async () => {
  const env = load();
  const lot = env.rf.store.data().lots.find((row) => row.stage === "finishing");
  env.asDb(emp("RB", "staff"));
  const rb = await env.rfOpen("p=finishing");
  assert.doesNotMatch(rb, /data-rf-open="coa"|tab=coa/);
  assert.match(rb, /rf-badge/, "the QC badge stays");
  env.asDb(emp("PP", "factory_manager"));
  assert.ok((await env.rfOpen("p=finishing")).includes(`href="#/qa?tab=coa&amp;lot=${lot.id}"`));
  env.asDb(emp("PP", "staff"));
  assert.ok((await env.rfOpen("p=finishing")).includes(`href="#/qa?tab=coa&amp;lot=${lot.id}"`), "planning gets the link too");
  env.asDb(STAFF);
  assert.equal(await env.rfOpen("p=finishing"), "<notfound></notfound>", "QA staff work in #/qa: the RubberFlow station page is not theirs");
  // skip ageing (endRest): unchanged rights and the button is on the mixing page
  const rfApi = env.rfApi;
  assert.deepEqual([emp("RB", "department_manager"), STAFF, emp("RB", "staff"), emp("PP", "staff")].map((employee) => rfApi.can(rfApi.personaUser(employee), "skipRest")), [true, true, false, false]);
  assert.match(read("modules/rubberflow-pages-line.js"), /ctx\.can\("skipRest"\) \? ui\.openButton\("ข้ามเวลาบ่ม", "skipRest"/);
});

test("the QA module files: pages in qa-pages.js, loaded before module-qa.js with one new ?v= on every entry; no copy of the RubberFlow quality screens", () => {
  const index = read("index.html");
  const scripts = [...index.matchAll(/<script defer src="\.\/([^"?]+)\?v=([^"]+)"/g)];
  const order = scripts.map((match) => match[1]);
  assert.ok(order.indexOf("modules/qa-pages.js") >= 0 && order.indexOf("modules/qa-pages.js") < order.indexOf("modules/module-qa.js"), "qa-pages.js before module-qa.js");
  assert.ok(order.indexOf("modules/module-qa.js") < order.indexOf("app.js"));
  assert.equal(new Set(scripts.map((match) => match[2])).size, 1, "one ?v= for every entry");
  assert.match(scripts[0][2], /^\d{8}[a-z0-9]+$/, "a dated ?v= value");
  const quality = read("modules/rubberflow-pages-quality.js");
  assert.doesNotMatch(quality, /pages\.(quality|spc|trace)\s*=/, "the RubberFlow pages are gone, the bodies are shared views");
  const pagesSource = read("modules/qa-pages.js");
  for (const copied of ["controlChart", "histogram", "derive.backwardTree", "lookupCode", "SPECS.lab"]) assert.ok(!pagesSource.includes(copied), `qa-pages.js does not redraw ${copied}`);
  assert.doesNotMatch(pagesSource, /แท่ง/);
  assert.doesNotMatch(read("modules/module-qa.js"), /แท่ง/);
});

test("every text from the data is escaped on every QA page", async () => {
  const env = load({ employee: HEAD }).asDb(HEAD);
  const XSS = "<script>alert(1)</script>";
  const data = env.rf.store.data();
  const lot = data.lots.find((row) => row.qc === "hold");
  lot.holdReasons = [XSS];
  const material = data.materialLots.find((row) => row.status === "hold");
  material.lotNo = `RM-${XSS}`;
  material.supplier = XSS;
  const ncr = data.ncrs.find((row) => row.status === "open");
  Object.assign(ncr, { title: XSS, lotId: XSS, containment: XSS, corrective: XSS, preventive: XSS, whys: [XSS] });
  data.qcRecords[0].note = XSS;
  data.qcRecords[0].inspector = XSS;
  for (const query of ["", "tab=records", "tab=ncr", "tab=coa", "tab=spc", "tab=trace", "tab=material", `tab=trace&q=${encodeURIComponent(XSS)}`, `tab=records&q=${encodeURIComponent(XSS)}`, `tab=material&q=${encodeURIComponent(XSS)}`, `tab=coa&lot=${encodeURIComponent(XSS)}`, `tab=spc&ch=${encodeURIComponent(XSS)}`]) {
    const html = await env.open(query);
    assert.doesNotMatch(html, /<script>/, query || "work");
  }
  assert.match(await env.open(""), /&lt;script&gt;/);
  assert.match(await env.open("tab=ncr"), /&lt;script&gt;/);
  assert.match(await env.open("tab=records"), /&lt;script&gt;/);
});
