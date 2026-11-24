import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โมดูลคลังวัตถุดิบ (ST) #/st · modules/st-pages.js (โรงงาน ขั้น 3 · 20261220010000) และคลังเคมีของ RB (RubberFlow p=rbstore)
// เมนู · ใครเปิดหน้าไหนได้ (ST / PP / ผู้จัดการ เต็ม · RB ดูเคมีอย่างเดียว · WH ดูและนับของซื้อ · คนอื่นไม่พบหน้า) · ในคลังไม่แสดงของที่ยอด 0 · ตัวกรองชนิด · ทีละ 100 แถว
// · การเปลี่ยนที่อยู่ของ BOM p=stock · งานของฉัน (ใบขอเบิก ใบคืน ใบสั่งซื้อ) · หน้าต่างจ่ายเคมีแสดงล็อต FEFO · ถ้อยคำที่บอกชื่อคลัง
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, ...extra });
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const rowsOf = (html) => (html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1]?.split("<tr").slice(1) ?? [];
const XSS = "<script>alert(1)</script>";

function load({ employee = emp("ST"), bomUser = "B08", rfUser = "U04" } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: "#/st", toasts: [] };
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
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; }, replace(value) { log.hash = value; } },
    app, state: { employee },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic(), addEventListener() {} },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  for (const file of FILES) vm.runInContext(read(file), context, { filename: file });
  const modules = context.MNP_REQUEST_MODULES;
  const bom = context.MNP_BOM.store;
  if (bomUser) bom.setUser(bomUser);
  const rf = context.MNP_RUBBERFLOW;
  if (rfUser) rf.store.setUser(rfUser);
  const open = async (query = "") => {
    log.hash = `#/st${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await modules.FACTORY_ST.pages.st(new URLSearchParams(query));
    return app.innerHTML;
  };
  const rfOpen = async (query) => {
    log.hash = `#/rubberflow?${query}`;
    app.innerHTML = "";
    await modules.RUBBERFLOW.pages.rubberflow(new URLSearchParams(query));
    return app.innerHTML;
  };
  const bomOpen = async (query) => {
    log.hash = `#/bom?${query}`;
    app.innerHTML = "";
    await modules.BOM.pages.bom(new URLSearchParams(query));
    return app.innerHTML;
  };
  return { context, app, log, fakes, modules, bom, rf, open, rfOpen, bomOpen, setEmployee: (next) => { context.state.employee = next; } };
}
const navOf = (env) => {
  const item = env.modules.FACTORY_ST.nav[0];
  return [...item.subnav(item.path).matchAll(/<a class="rf-nav-item( is-active)?" href="([^"]*)"[^>]*>[\s\S]*?<span class="rf-nav-text">([^<]*)<\/span>(?:<span class="rf-nav-count"[^>]*>(\d+)<\/span>)?<\/a>/g)]
    .map((match) => ({ label: match[3], href: match[2], active: Boolean(match[1]), count: match[4] ? Number(match[4]) : 0 }));
};

test("menu: งานของฉัน first (with the count of the cards), then ในคลัง, ใบสั่งซื้อ, จ่ายออก, รับคืน, นับสต็อก; the item and lot pages belong to ในคลัง", async () => {
  const env = load();
  const html = await env.open();
  assert.equal(h1Of(html), "งานของฉัน");
  const items = navOf(env);
  assert.deepEqual(items.map((item) => [item.label, item.href]), [["งานของฉัน", "#/st"], ["ในคลัง", "#/st?tab=stock"], ["ใบสั่งซื้อ", "#/st?tab=po"], ["จ่ายออก", "#/st?tab=issue"], ["รับคืน", "#/st?tab=returns"], ["นับสต็อก", "#/st?tab=count"]]);
  assert.equal(items[0].count, cardsOf(html).length, "the menu number is the number of cards on the page");
  assert.ok(items[0].count > 0, "the demo has work for the store");
  for (const [tab, label] of [["stock", "ในคลัง"], ["po", "ใบสั่งซื้อ"], ["issue", "จ่ายออก"], ["returns", "รับคืน"], ["count", "นับสต็อก"]]) assert.equal(h1Of(await env.open(`tab=${tab}`)), label, tab);
  const lotNo = env.rf.store.data().materialLots.find((lot) => lot.qtyKg > 0).lotNo;
  await env.open(`lot=${encodeURIComponent(lotNo)}`);
  assert.equal(navOf(env).find((item) => item.active)?.label, "ในคลัง", "a lot page sits under ในคลัง");
});

test("who opens #/st: ST staff and head, PP and the managers see the module; RB, WH and QA only reach their pages by link; everyone else gets not found", async () => {
  const { modules, context } = load();
  const allowed = [emp("ST"), emp("ST", "department_manager"), emp("PP"), emp("AD", "admin"), emp("PP", "factory_manager"), emp("OFFICE", "general_manager")];
  const hidden = [emp("RB"), emp("RB", "department_manager"), emp("WH"), emp("QA"), emp("QA", "department_manager"), emp("GR"), emp("SR", "department_manager"), emp("ID"), emp("HR"), { ...emp("ST"), isSandbox: false }];
  for (const employee of allowed) assert.equal(modules.FACTORY_ST.navAllowed(employee), true, JSON.stringify(employee));
  for (const employee of hidden) assert.equal(modules.FACTORY_ST.navAllowed(employee), false, `${JSON.stringify(employee)} has no menu entry`);
  const pages = context.MNP_ST_PAGES;
  assert.deepEqual([emp("RB"), emp("WH"), emp("QA"), emp("QA", "department_manager"), emp("GR"), emp("ST")].map(pages.guest), ["rb", "wh", "qa", "qa", null, null], "the guest modes by department");
  for (const employee of [emp("GR"), emp("SR"), emp("ID"), emp("HR"), emp("GR", "department_manager"), { ...emp("RB"), isSandbox: false }, { ...emp("QA"), isSandbox: false }]) {
    const env = load({ employee, bomUser: null });
    await env.open("tab=stock");
    assert.equal(env.log.notFound, 1, `${JSON.stringify(employee)} is refused`);
  }
});

test("RB sees the chemicals of the ST store read-only: one list of lots, no filter, no button, no other page", async () => {
  const env = load({ employee: emp("RB"), bomUser: "B04", rfUser: "U05" });
  const html = await env.open("tab=stock");
  assert.equal(env.log.notFound, 0);
  assert.equal(h1Of(html), "ในคลัง");
  const rows = rowsOf(html);
  assert.ok(rows.length > 0, "the demo ST store holds chemical lots");
  assert.ok(rows.every((row) => /href="#\/st\?lot=/.test(row)), "only chemical lots");
  assert.doesNotMatch(html, /data-rf-open|data-rf-action|data-rf-form|data-st-filter|data-rf-scope/, "read-only: no button, form or filter");
  for (const tab of ["po", "issue", "returns", "count", ""]) assert.equal(h1Of(await env.open(tab ? `tab=${tab}` : "")), "ในคลัง", `RB on ${tab || "work"} sees ในคลัง`);
  const part = env.bom.data().items.find((item) => item.kind === "PURCHASED");
  assert.equal(h1Of(await env.open(`part=${encodeURIComponent(part.code)}`)), "ในคลัง", "no purchased-part page for RB");
  const lotNo = env.rf.store.data().materialLots.find((lot) => lot.qtyKg > 0).lotNo;
  const lot = await env.open(`lot=${encodeURIComponent(lotNo)}`);
  assert.match(lot, /คลัง ST[\s\S]*คลัง RB/, "the lot page shows both stores");
  assert.doesNotMatch(lot, /data-rf-open|data-rf-action|data-rf-scope/, "no label or hold button for RB");
});

test("QA sees the chemicals of the ST store and holds or releases a lot on its page (the right QA had in RubberFlow); no issue, purchase order, count or label button", async () => {
  const env = load({ employee: emp("QA"), bomUser: "B12", rfUser: "U09" });
  const html = await env.open("tab=stock");
  assert.equal(env.log.notFound, 0, "QA reaches the page by link");
  assert.equal(h1Of(html), "ในคลัง");
  const rows = rowsOf(html);
  assert.ok(rows.length > 0 && rows.every((row) => /href="#\/st\?lot=/.test(row)), "only chemical lots");
  assert.doesNotMatch(html, /data-rf-open|data-rf-action|data-rf-form|data-st-filter|data-rf-scope/, "the list itself has no button, form or filter");
  for (const tab of ["po", "issue", "returns", "count", ""]) {
    const page = await env.open(tab ? `tab=${tab}` : "");
    assert.equal(h1Of(page), "ในคลัง", `QA on ${tab || "work"} sees ในคลัง`);
    assert.doesNotMatch(page, /issueChemicals|chemIssue|receiveChemicalReturn|receivePurchase|receiveMaterial|countPartStock|data-rf-open="purchase"/, `no store button on ${tab || "work"}`);
  }
  const part = env.bom.data().items.find((item) => item.kind === "PURCHASED");
  assert.equal(h1Of(await env.open(`part=${encodeURIComponent(part.code)}`)), "ในคลัง", "no purchased-part page for QA");
  const lot = env.rf.store.data().materialLots.find((row) => row.qtyKg > 0 && row.status !== "hold" && row.expiry > Date.now());
  const page = await env.open(`lot=${encodeURIComponent(lot.lotNo)}`);
  assert.equal(h1Of(page), `ล็อต ${lot.lotNo}`);
  assert.match(page, /<div data-rf-scope="rubberflow"><button[^>]*data-rf-action="setMaterialLotStatus"[^>]*>กักกัน<\/button><\/div>/, "the only button is the hold, bound by RubberFlow");
  assert.doesNotMatch(page, /data-rf-open|data-rf-form|>ปลดกักกัน</, "no label button, no form, no release while the lot is available");
  assert.equal(env.rf.runAction("setMaterialLotStatus", { lotNo: lot.lotNo, status: "hold" }, "ok"), true, JSON.stringify(env.log.toasts));
  const held = await env.open(`lot=${encodeURIComponent(lot.lotNo)}`);
  assert.match(held, /data-rf-action="setMaterialLotStatus"[^>]*>ปลดกักกัน</, "a held lot offers the release");
  assert.doesNotMatch(held, />กักกัน</);
  // สิทธิ์ของบัญชี QA ในโหมดฐานข้อมูล: กักกันได้ ส่วนจ่าย ขอเบิก นับ สั่งซื้อ รับเข้าไม่ได้
  const qa = env.context.MNP_RUBBERFLOW_STORE.personaUser({ ...emp("QA"), id: "qa" });
  assert.deepEqual(["holdMaterial", "issueChem", "requestChem", "countRb", "purchase", "receiveMaterial"].map((right) => env.context.MNP_RUBBERFLOW_STORE.can(qa, right)), [true, false, false, false, false, false]);
  // หน้าคลังวัตถุดิบของ RubberFlow พา QA มาที่นี่
  assert.match(await env.rfOpen("p=warehouse"), /href="#\/st\?tab=stock"[^>]*>ดูเคมีในคลัง ST</, "the RubberFlow warehouse tab links QA to the ST chemicals");
});

test("WH sees the purchased parts of the ST store and counts them (no safety stock, no chemicals, no other page)", async () => {
  const env = load({ employee: emp("WH"), bomUser: "B09", rfUser: null });
  const data = env.bom.data();
  const part = data.items.find((item) => item.kind === "PURCHASED");
  data.stock = [{ itemCode: part.code, qty: 9, safetyQty: 3 }];
  const html = await env.open("tab=stock");
  assert.equal(h1Of(html), "ในคลัง");
  assert.ok(rowsOf(html).every((row) => /href="#\/st\?part=/.test(row)), "only purchased parts");
  assert.match(html, /<nav class="rf-tabs"[\s\S]*ในคลัง[\s\S]*นับสต็อก/, "in-page tabs (no side menu for a guest)");
  const count = await env.open("tab=count");
  assert.equal(h1Of(count), "นับสต็อก");
  assert.match(count, /data-rf-form="countPartStock"/);
  assert.match(count, /name="qty\[\]"/);
  assert.doesNotMatch(count, /name="safetyQty\[\]"/, "WH cannot set the safety stock");
  assert.equal(h1Of(await env.open("tab=po")), "ในคลัง", "no purchase orders for WH");
  const lotNo = env.rf.store.data().materialLots.find((lot) => lot.qtyKg > 0).lotNo;
  assert.equal(h1Of(await env.open(`lot=${encodeURIComponent(lotNo)}`)), "ในคลัง", "no chemical lot page for WH");
  const page = await env.open(`part=${encodeURIComponent(part.code)}`);
  assert.equal(h1Of(page), part.code);
  assert.match(page, /data-rf-form="countPartStock"/);
  assert.doesNotMatch(page, /name="safetyQty\[\]"[^>]*type="number"/);
});

test("ในคลัง: one list of purchased parts and chemical lots with stock only; ~900 zero-stock parts never show; filter by type, search by code, name or lot, 100 rows a page", async () => {
  const env = load();
  const data = env.bom.data();
  for (let n = 0; n < 900; n += 1) data.items.push({ code: `Z-ZERO-${String(n).padStart(3, "0")}`, kind: "PURCHASED", name: `ของซื้อยอดศูนย์ ${n}`, uom: "pcs", active: true });
  for (let n = 0; n < 150; n += 1) {
    const code = `A-STOCK-${String(n).padStart(3, "0")}`;
    data.items.push({ code, kind: "PURCHASED", name: `ของซื้อมีของ ${n}`, uom: "pcs", active: true });
    data.stock.push({ itemCode: code, qty: n + 1, safetyQty: n === 0 ? 5 : 0 });
  }
  const html = await env.open("tab=stock");
  assert.doesNotMatch(html, /Z-ZERO-/, "zero-stock parts are not listed");
  assert.equal(rowsOf(html).length, 100, "100 rows a page");
  assert.match(html, /href="#\/st\?tab=stock&amp;n=200"[^>]*>แสดงเพิ่ม \(อีก \d+\)/);
  const parts = await env.open("tab=stock&kind=part&n=500");
  assert.ok(rowsOf(parts).every((row) => /href="#\/st\?part=/.test(row)) && rowsOf(parts).some((row) => row.includes("A-STOCK-149")));
  assert.doesNotMatch(parts, /Z-ZERO-/);
  assert.equal((rowsOf(parts).filter((row) => row.includes("ต่ำกว่าขั้นต่ำ")).filter((row) => row.includes("A-STOCK-"))).length, 1, "the part under its safety stock is flagged");
  const chem = await env.open("tab=stock&kind=chem");
  const lots = env.rf.store.data().materialLots.filter((lot) => lot.qtyKg > 0.0001);
  assert.equal(rowsOf(chem).length, lots.length, "one row per chemical lot with ST stock");
  assert.ok(rowsOf(chem).every((row) => /href="#\/st\?lot=/.test(row)));
  assert.ok(!env.rf.store.data().materialLots.filter((lot) => !(lot.qtyKg > 0.0001)).some((lot) => chem.includes(`lot=${encodeURIComponent(lot.lotNo)}"`)), "a lot with nothing left in ST is not listed");
  const lot = lots[0];
  const found = await env.open(`tab=stock&q=${encodeURIComponent(lot.lotNo)}`);
  assert.equal(rowsOf(found).length, 1, "search by lot number");
  assert.match(await env.open("tab=stock&q=ZZZ-NONE"), /ไม่พบรายการที่ค้นหา/);
  assert.match(await env.open("tab=stock&q=Z-ZERO-001"), /ไม่พบรายการที่ค้นหา/, "the store view does not search the zero-stock register (นับสต็อก does)");
  assert.match(await env.open("tab=count&q=Z-ZERO-001"), /name="itemCode\[\]" value="Z-ZERO-001"/, "the count tab reaches the whole register");
  // ล้างคำค้นในมุมมองในคลัง = ยังอยู่ในคลัง
  const form = { handlers: {}, dataset: {}, __values: { q: "" }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  await env.open("tab=stock&kind=chem&q=abc");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/st?tab=stock&kind=chem");
});

test("BOM p=stock moves to #/st?tab=stock for the ST module and WH, and to BOM home for anyone else", async () => {
  for (const [employee, bomUser, target] of [[emp("ST"), "B08", "#/st?tab=stock"], [emp("WH"), "B09", "#/st?tab=stock"], [emp("PP"), "B03", "#/st?tab=stock"], [emp("RB"), "B04", "#/bom?p=orders"], [emp("GR"), "B05", "#/bom?p=orders"]]) {
    const env = load({ employee, bomUser });
    await env.bomOpen("p=stock");
    assert.equal(env.log.hash, target, `${employee.department.code}`);
  }
});

test("งานของฉัน: RB requests to issue, RB returns to receive and purchase orders to receive are cards with the store's own buttons (bound by RubberFlow)", async () => {
  const env = load();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const rfData = env.rf.store.data();
  const html = await env.open();
  const cards = cardsOf(html);
  for (const doc of rules.chemRequestsToIssue(rfData)) assert.ok(cards.some((card) => card.includes(`จ่ายเคมีตามใบขอเบิก ${doc.id}`) && card.includes('data-rf-open="chemIssue"')), doc.id);
  for (const doc of rules.chemReturnsPending(rfData)) assert.ok(cards.some((card) => card.includes(`รับเคมีคืนจาก RB ใบ ${doc.id}`) && card.includes(">รับคืนเข้าคลังวัตถุดิบ (ST)<") && card.includes('data-rf-open="chemReject"')), doc.id);
  const po = rfData.purchaseOrders.find((row) => row.status === "ordered");
  assert.ok(cards.some((card) => card.includes(`รับเข้าตามใบสั่งซื้อ ${po.id}`) && new RegExp(`href="#/st\\?tab=po&amp;q=${po.id}"[^>]*>รับเข้าคลังวัตถุดิบ \\(ST\\)<`).test(card)), "the purchase order card names the store on its button");
  assert.match(html, /<div data-rf-scope="rubberflow">/, "the RubberFlow buttons sit in a part the RubberFlow binder owns");
  assert.ok(cards.length <= 60 && cards.every((card) => (card.match(/<li>/g) ?? []).length <= 5), "a card lists at most five lines");
  // ฝ่ายวางแผนเห็นงานเดียวกันแต่ไม่มีปุ่มของ ST (จ่ายเคมีและรับคืนเป็นของ ST)
  const planner = load({ employee: emp("PP"), bomUser: "B03", rfUser: null });
  const view = await planner.open();
  assert.ok(cardsOf(view).some((card) => card.includes("จ่ายเคมีตามใบขอเบิก")));
  assert.doesNotMatch(view, /data-rf-open="chemIssue"|receiveChemicalReturn/);
});

test("the issue dialog shows the lots FEFO picks from the ST store before confirming; a partial issue moves kilos from ST to RB, then ST closes the rest with a reason", async () => {
  const env = load();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const dialogs = env.context.MNP_RUBBERFLOW_DIALOGS;
  const rfCtx = () => env.rf.context(new URLSearchParams());
  const doc = rules.chemRequestsToIssue(env.rf.store.data()).find((row) => row.status === "open");
  const preview = rules.chemIssuePreview(env.rf.store.data(), doc, undefined, rfCtx().now, { remote: false });
  const built = dialogs.chemIssue(rfCtx(), { id: doc.id });
  for (const row of preview) for (const pick of row.picks) assert.ok(built.html.includes(pick.lotNo), `${row.materialCode} shows its FEFO lot ${pick.lotNo}`);
  assert.match(built.html, /data-rf-form="issueChemicals"/);
  assert.match(built.html, />จ่ายจากคลังวัตถุดิบ \(ST\)</);
  // จ่ายครึ่งเดียวของบรรทัดแรก: ส่วนที่เหลือค้าง · ยอดย้ายจาก ST ไป RB
  const first = doc.lines[0];
  const lot = env.rf.store.data().materialLots.find((row) => row.lotNo === preview[0].picks[0].lotNo);
  const [stBefore, rbBefore] = [lot.qtyKg, lot.rbKg ?? 0];
  const half = Math.min(first.qtyKg / 2, preview[0].picks[0].kg);
  const ok = env.rf.runAction("issueChemicals", env.rf.transforms.issueChemicals({ id: doc.id, issueKg: doc.lines.map((_, index) => (index === 0 ? String(half) : "0")) }), "ok");
  assert.equal(ok, true, JSON.stringify(env.log.toasts));
  const moved = env.rf.store.data().materialLots.find((row) => row.lotNo === lot.lotNo);
  assert.ok(Math.abs(moved.qtyKg - (stBefore - half)) < 1e-6 && Math.abs(moved.rbKg - (rbBefore + half)) < 1e-6, "the kilos moved from ST to RB");
  const after = rules.chemDocsOf(env.rf.store.data()).find((row) => row.id === doc.id);
  assert.equal(after.status, "partial");
  const close = dialogs.chemClose(rfCtx(), { id: doc.id }).html;
  assert.match(close, /data-rf-form="closeChemicalRequest"/);
  assert.match(close, /name="reason"[^>]*required[^>]*minlength="3"/);
  assert.equal(env.rf.runAction("closeChemicalRequest", { id: doc.id, reason: "RB ใช้เท่าที่จ่าย" }, "ok"), true);
  assert.equal(rules.chemDocsOf(env.rf.store.data()).find((row) => row.id === doc.id).status, "closed");
  assert.equal(dialogs.chemIssue(rfCtx(), { id: doc.id }), null, "a closed request has no issue dialog");
});

test("returns: ST receives an RB return whole or rejects it with a reason; the old ST-store requisition returns are listed on the same page", async () => {
  const env = load();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const html = await env.open("tab=returns");
  const pending = rules.chemReturnsPending(env.rf.store.data());
  assert.ok(pending.length > 0);
  assert.match(html, /ใบคืนเคมีจาก RB/);
  assert.match(html, /data-rf-action="receiveChemicalReturn"[^>]*>รับคืนเข้าคลังวัตถุดิบ \(ST\)</);
  const reject = env.context.MNP_RUBBERFLOW_DIALOGS.chemReject(env.rf.context(new URLSearchParams()), { id: pending[0].id }).html;
  assert.match(reject, /data-rf-form="rejectChemicalReturn"/);
  assert.match(reject, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.equal(env.rf.runAction("receiveChemicalReturn", { id: pending[0].id }, "ok"), true);
  assert.match(await env.open("tab=returns"), /ST รับคืนแล้ว/, "the handled return moves to the recent list");
});

test("purchase orders: the RubberFlow table and dialogs, the store-named receive button, and the RubberFlow warehouse tabs point here", async () => {
  const env = load();
  const html = await env.open("tab=po");
  assert.match(html, /data-rf-open="receiveMaterial"[^>]*>รับเข้าคลังวัตถุดิบ \(ST\)</);
  assert.match(html, /data-rf-open="receivePurchase"[^>]*>รับเข้าคลังวัตถุดิบ \(ST\)</, "the line receive button names the store");
  assert.doesNotMatch(html, /ตรวจสอบรับเข้า</);
  assert.match(html, /data-rf-open="closePurchase"/);
  assert.match(html, /data-rf-scope="rubberflow"/);
  const po = env.rf.store.data().purchaseOrders[0];
  assert.match(await env.open(`tab=po&q=${po.id}`), new RegExp(po.id));
  const raw = await env.rfOpen("p=warehouse");
  assert.match(raw, /href="#\/st\?tab=stock"[^>]*>ไปที่คลังวัตถุดิบ \(ST\)</);
  assert.match(await env.rfOpen("p=warehouse&tab=po"), /href="#\/st\?tab=po"[^>]*>ไปที่ใบสั่งซื้อของคลังวัตถุดิบ \(ST\)</);
  assert.doesNotMatch(raw, /setMaterialLotStatus|data-rf-open="tag"/, "no lot list left in RubberFlow");
});

test("จ่ายออก: parts per order open the BOM issue / return / undo dialogs; ?order= narrows to one order", async () => {
  const env = load();
  const html = await env.open("tab=issue");
  assert.match(html, /เคมีตามใบขอเบิกของ RB/);
  assert.match(html, /data-rf-open="issueParts"/);
  const orderId = /data-rf-open="issueParts" data-rf-args="\{&quot;orderId&quot;:&quot;([^&]+)&quot;\}"/.exec(html)[1];
  const one = await env.open(`tab=issue&order=${orderId}`);
  assert.match(one, new RegExp(`เฉพาะใบ ${orderId}`));
  assert.doesNotMatch(one, /เคมีตามใบขอเบิกของ RB/, "the chemical requests are not part of one order");
  assert.ok(env.context.MNP_BOM_DIALOGS.issueParts(env.context.MNP_BOM.context(new URLSearchParams()), { orderId }), "the dialog is the BOM one");
});

test("the lot page: both stores, the label and hold buttons for whoever may hold, text from the data is escaped", async () => {
  const env = load({ employee: emp("AD", "admin"), bomUser: "B01", rfUser: "U01" });
  const rfData = env.rf.store.data();
  const lot = rfData.materialLots.find((row) => row.qtyKg > 0 && row.status !== "hold" && row.expiry > Date.now());
  lot.supplier = XSS;
  rfData.materials.find((row) => row.code === lot.materialCode).name = XSS;
  const html = await env.open(`lot=${encodeURIComponent(lot.lotNo)}`);
  assert.equal(h1Of(html), `ล็อต ${lot.lotNo}`);
  assert.match(html, /data-rf-open="tag"[^>]*>พิมพ์ป้าย</);
  assert.match(html, /data-rf-action="setMaterialLotStatus"[^>]*>กักกัน</);
  assert.doesNotMatch(html, /<script>/);
  for (const page of ["tab=stock", "", "tab=issue", "tab=returns", `lot=${encodeURIComponent(lot.lotNo)}`]) assert.doesNotMatch(await env.open(page), /<script>/, page);
});

test("RubberFlow คลังเคมี RB: RB lots, requests and returns with their status, the count only for the RB head and planning, the usage table and a link to the ST chemicals", async () => {
  const env = load({ employee: emp("RB"), bomUser: "B04", rfUser: "U05" });
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const rfData = env.rf.store.data();
  const html = await env.rfOpen("p=rbstore");
  assert.match(html, /<h1>คลังเคมี RB<\/h1>/);
  assert.equal(rowsOf(html).length, rules.rbStockLots(rfData, Date.now()).length, "one row per lot the RB store holds");
  assert.match(html, /data-rf-open="chemRequest"[^>]*>ขอเบิกจาก ST</);
  assert.match(html, /data-rf-open="chemReturn"[^>]*>คืนให้ ST</);
  assert.match(html, /href="#\/st\?tab=stock&amp;kind=chem"[^>]*>ดูเคมีในคลัง ST</);
  const requests = await env.rfOpen("p=rbstore&tab=requests");
  for (const doc of rules.chemDocsOf(rfData).filter((row) => row.kind === "request")) assert.ok(requests.includes(doc.id), doc.id);
  assert.match(requests, /รอ ST จ่าย/);
  assert.match(requests, /data-rf-action="cancelChemicalRequest"/, "a request not yet issued can be cancelled");
  assert.match(await env.rfOpen("p=rbstore&tab=returns"), /รอ ST รับคืน/);
  assert.match(await env.rfOpen("p=rbstore&tab=usage"), /ใช้ตามสูตร \(kg\)[\s\S]*รวม/);
  const rbCtx = (user) => ({ ...env.rf.context(new URLSearchParams()), can: (permission) => env.context.MNP_RUBBERFLOW_STORE.can(user, permission) });
  const persona = (employee) => env.context.MNP_RUBBERFLOW_STORE.personaUser({ ...employee, id: "x" });
  assert.equal(env.context.MNP_RUBBERFLOW_DIALOGS.rbCount(rbCtx(persona(emp("RB"))), {}), null, "RB staff cannot count the RB store");
  assert.match(env.context.MNP_RUBBERFLOW_DIALOGS.rbCount(rbCtx(persona(emp("RB", "department_manager"))), {}).html, /data-rf-form="countRbStock"[\s\S]*name="reason"[^>]*required/, "the RB head counts with a reason");
  // หน้าต่างขอเบิก: ส่งเฉพาะแถวที่กรอก (ทะเบียนวัตถุดิบยาวได้ ใบหนึ่งไม่เกิน 100 รายการ)
  const payload = env.rf.transforms.requestChemicals({ materialCode: ["A", "B", "C"], qtyKg: ["", "5", " "], note: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(payload.lines)), [{ materialCode: "B", qtyKg: "5" }]);
});

test("wording: the store is named on its buttons, no rod word, and module-st.js only registers", () => {
  const source = read("modules/st-pages.js");
  assert.match(source, /รับเข้าคลังวัตถุดิบ \(ST\)/);
  assert.match(source, /รับคืนเข้าคลังวัตถุดิบ \(ST\)/);
  assert.match(source, /จ่ายจากคลังวัตถุดิบ \(ST\)/);
  for (const file of ["modules/st-pages.js", "modules/module-st.js"]) {
    const code = read(file).split(/\r?\n/).filter((line) => !line.trimStart().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /แท่ง/, file);
    assert.doesNotMatch(code, /"รับเข้าคลัง"/, `${file}: never a bare "รับเข้าคลัง"`);
    assert.doesNotMatch(code, /"ตรวจสอบรับเข้า"|"รับวัตถุดิบเข้าคลัง"/, `${file}: a receive button names the store`);
  }
  assert.match(read("modules/module-st.js"), /registerDeptModule\(\{ code: "FACTORY_ST"[^}]*guest: pages\.guest/);
  const index = read("index.html");
  assert.ok(index.indexOf("modules/st-pages.js") > 0 && index.indexOf("modules/st-pages.js") < index.indexOf("modules/module-st.js"), "st-pages.js loads before module-st.js");
});
