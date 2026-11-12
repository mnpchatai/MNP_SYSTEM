import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดโมดูล RubberFlow ทั้งชุด (modules/rubberflow-*.js + module-rubberflow.js, script ธรรมดาใน browser) เข้า context จำลองที่มี helper ของ app.js
// แบบ stub และ localStorage จำลอง แล้ววาดทุกหน้า × ทุกบทบาท เรียก dialog ทุกตัว และยิงฟอร์ม/ปุ่มผ่านกติกา data-rf-* ของไฟล์หลัก
const FILES = [
  "modules/ui-icons.js",
  "modules/rubberflow-rules.js",
  "modules/rubberflow-derive.js",
  "modules/rubberflow-actions.js",
  "modules/rubberflow-seed.js",
  "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js",
  "modules/rubberflow-pages-plan.js",
  "modules/rubberflow-pages-line.js",
  "modules/rubberflow-pages-quality.js",
  "modules/rubberflow-documents.js",
  "modules/module-rubberflow.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";
const PAGES = ["dashboard", "orders", "recipes", "requisition", "mixing", "extrusion", "curing", "finishing", "wip", "quality", "spc", "trace", "warehouse", "molds", "audit"];

function load({ sandbox = true, route = "", storage = new Map() } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: `#/rubberflow${route ? `?${route}` : ""}`, dialogs: [], confirms: [], confirmAnswer: true };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, hidden: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {} },
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
    insertAdjacentHTML(_, html) { log.dialogs.push(html); this.lastElementChild = { ...generic(), tagName: "DIALOG", innerHTML: html }; },
  });
  // ใน dialog ทุก selector คืน node ว่าง ๆ (bind ของ dialog ผูก event กับช่องที่มีจริงในเบราว์เซอร์)
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const localStorage = { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  Object.assign(context, {
    window: context, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async (options) => { log.confirms.push(options); return log.confirmAnswer; }, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, requestAnimationFrame: () => 0,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee: { isSandbox: sandbox } },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null },
    localStorage,
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {},
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const registered = context.MNP_REQUEST_MODULES.RUBBERFLOW;
  const render = async (query = route) => {
    log.hash = `#/rubberflow${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await registered.pages.rubberflow(new URLSearchParams(query));
    return app.innerHTML;
  };
  const ctx = (query = "") => context.MNP_RUBBERFLOW.context(new URLSearchParams(query));
  return { context, app, log, fakes, root, storage, module: registered, store: context.MNP_RUBBERFLOW.store, render, ctx };
}
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the module registers a sandbox-only standalone page, refuses users outside the sandbox and shows the role chooser first", async () => {
  const env = load();
  assert.equal(env.module.enabled, true);
  assert.equal(env.module.sandbox, true);
  assert.equal(env.module.standalone, true);
  assert.equal(env.module.nav[0].path, "rubberflow");
  assert.equal(env.module.nav[0].sandboxOnly, true);
  assert.equal(env.module.nav[0].subnav("factory"), "", "no sub-menu under other modules");
  assert.equal(env.module.nav[0].subnav("rubberflow"), "", "no sub-menu before a persona is chosen");
  const html = await env.render();
  assert.match(html, /<shell path="rubberflow" title="RubberFlow MES">/);
  assert.match(html, /<h1>RubberFlow MES<\/h1>/, "the intro card is the page's single h1");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  // D1: เลือกบทบาทจากช่องในแถบเครื่องมือ ไม่มีหน้าตารางบทบาทเต็มจอ และยังไม่มีสแกน/แจ้งเตือนก่อนรู้บทบาท
  assert.match(html, /<select[^>]*data-rf-user/, "the role is picked from the toolbar select");
  assert.equal((html.match(/<option value="[^"]+"/g) ?? []).length, 9, "nine demo roles besides the empty placeholder");
  assert.doesNotMatch(html, /data-rf-user-pick|rf-role-grid/, "no full-page role grid");
  assert.doesNotMatch(html, /data-rf-scan|data-rf-reset/, "scan, alerts and reset wait for a persona");
  assert.equal(env.module.nav[0].group, "ทดสอบ", "listed under the test group in the side menu");
  const outside = load({ sandbox: false });
  await outside.render();
  assert.equal(outside.log.notFound, 1);
  assert.match(outside.app.innerHTML, /<notfound>/);
});

test("every page renders for every persona without undefined/NaN, with the sidebar sub-menu and denial where the role has no access", async () => {
  const env = load();
  for (const user of env.store.data().users) {
    env.store.setUser(user.id);
    const sub = env.module.nav[0].subnav("rubberflow");
    assert.match(sub, /class="nav-sub rf-nav"/);
    for (const page of PAGES) {
      const html = await env.render(page === "dashboard" ? "" : `p=${page}`);
      const allowed = env.context.MNP_RUBBERFLOW_STORE.canSee(user, page);
      assert.equal(sub.includes(`href="#/rubberflow${page === "dashboard" ? "" : `?p=${page}`}"`), allowed, `${user.role} menu ${page}`);
      assert.doesNotMatch(html, /undefined|NaN/, `${user.role} ${page}`);
      assert.match(html, /rf-toolbar/);
      assert.match(html, new RegExp(`<option value="${user.id}" selected>`), "persona select shows the chosen role");
      if (allowed) {
        assert.doesNotMatch(html, /ไม่มีสิทธิ์เข้าถึงโมดูลนี้/, `${user.role} ${page}`);
        assert.equal((html.match(/<h1>/g) ?? []).length, 1, `${user.role} ${page}: exactly one h1`);
      } else { assert.match(html, /<h1>ไม่มีสิทธิ์เข้าถึงโมดูลนี้<\/h1>/, `${user.role} ${page}`); assert.equal((html.match(/<h1>/g) ?? []).length, 1); }
    }
  }
  env.store.setUser("U01");
  const unknown = await env.render("p=nope");
  assert.equal(unknown, "", "an unknown page redirects to the role's home instead of drawing");
  assert.equal(env.log.hash, "#/rubberflow");
});

test("a mixing lot that finishes resting within five minutes re-renders the page when it is ready, so the Send button shows without waiting for the minute tick (after skipping the rest the server's readyAt can be a few seconds ahead of this clock); a longer rest waits for the tick", async () => {
  const env = load();
  env.store.setUser("U01");
  const timers = [];
  env.context.setTimeout = (fn, ms) => {
    const timer = { ms, cleared: false };
    timer.fn = () => { timer.cleared = true; fn(); }; // a timer that fired is no longer live, like a real one
    timers.push(timer);
    return timers.length;
  };
  env.context.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  env.context.document.querySelector = (selector) => (selector === "dialog[open]" ? null : env.root);
  const live = () => timers.filter((timer) => !timer.cleared);
  const resting = env.store.data().lots.find((lot) => lot.stage === "mixing" && lot.readyAt > Date.now());
  assert.ok(resting.readyAt - Date.now() > 5 * 60000, "the seed batch still rests for hours");
  await env.render("p=mixing");
  assert.equal(live().length, 0, "a long rest is left to the minute tick");
  resting.readyAt = Date.now() + 3000;
  await env.render("p=mixing");
  assert.equal(live().length, 1, "one timer for the next lot that becomes ready");
  assert.ok(live()[0].ms >= 3000 && live()[0].ms <= 3400, `fires just after readyAt (${live()[0].ms} ms)`);
  await env.render("p=mixing");
  assert.equal(live().length, 1, "rendering again replaces the timer instead of adding one");
  const before = env.log.renders;
  live()[0].fn();
  assert.equal(env.log.renders, before + 1, "the timer re-renders the page");
  assert.equal(live().length, 0, "the fired timer is spent");
  resting.readyAt = Date.now() + 2000;
  await env.render("p=mixing");
  assert.equal(live().length, 1, "the next lot close to ready gets a new timer");
  assert.ok(live()[0].ms >= 2000 && live()[0].ms <= 2400, `the new timer fires just after its readyAt (${live()[0].ms} ms)`);
  env.context.document.querySelector = () => env.root; // a dialog is open
  live()[0].fn();
  assert.equal(env.log.renders, before + 1, "not while a dialog is open (the minute tick tries again)");
});

test("the dashboard, stations and quality pages show the prototype's facts from the seed", async () => {
  const env = load();
  env.store.setUser("U01");
  const dashboard = text(await env.render());
  assert.match(dashboard, /อัตราได้ของดีรวม 4 ขั้นตอน/);
  assert.match(dashboard, /ใบสั่งผลิตที่เปิดอยู่ 3/, "released + in_progress orders");
  assert.match(dashboard, /1\. ผสมยาง[\s\S]*4\. ตกแต่งและบรรจุ/);
  assert.equal((dashboard.match(/ล็อตทั้งหมด|งานรอเข้า/g) ?? []).length, 0, "station labels are table column heads, not repeated on every card");
  assert.match(await env.render(), /rf-chart-area[\s\S]*rf-chart-bar/, "both SVG charts are drawn");
  const mixing = await env.render("p=mixing");
  assert.match(mixing, /สถานีที่ 1 · ผสมยาง/);
  assert.match(mixing, /บ่มอีก/, "the batch mixed 1.5 hours ago shows its rest timer");
  assert.match(mixing, /data-rf-action="endRest"/, "admin may skip the rest in demo mode");
  const gated = await env.render("p=extrusion");
  assert.match(gated, /กักรอตัดสิน/);
  assert.match(gated, /ด่านรับมอบ/, "nothing received at extrusion yet");
  assert.doesNotMatch(gated, /data-rf-form="recordExtrusion"/);
  // ข้ามเวลาบ่ม ส่งต่อ และรับมอบ → ฟอร์มบันทึกการฉีดโผล่พร้อมช่องสเปก
  const resting = env.store.data().lots.find((lot) => lot.stage === "mixing" && lot.readyAt > Date.now());
  env.store.run("endRest", { lotId: resting.id });
  const transferId = env.store.run("createTransfer", { lotId: resting.id, qty: 10 }).result;
  env.store.run("receiveTransfer", { id: transferId, qtyReceived: 10 });
  const extrusion = await env.render("p=extrusion");
  assert.match(extrusion, /data-rf-form="recordExtrusion"/);
  assert.match(extrusion, new RegExp(`<option value="${transferId}">`), "the received transfer is offered as the source");
  assert.match(extrusion, /data-spec data-lsl="2.38" data-usl="2.62"/, "spec inputs carry their limits");
  const finishing = await env.render("p=finishing");
  assert.match(finishing, /ด่านรับมอบ/, "nothing received at finishing yet");
  assert.doesNotMatch(finishing, /data-rf-form="recordFinishing"/);
  const quality = text(await env.render("p=quality"));
  assert.match(quality, /ล็อตกักรอตัดสิน 1/);
  assert.match(quality, /NCR \/ CAR/);
  const ncr = await env.render("p=quality&tab=ncr");
  assert.match(ncr, /วิเคราะห์ทำไม 5 ครั้ง \(5-Why\)/);
  assert.match(ncr, /data-rf-form="closeNcr"/, "the open NCR has a close form for QC");
  const spc = await env.render("p=spc&ch=cu.temp");
  assert.match(spc, /แผนภูมิควบคุม · อบ · อุณหภูมิอบ/);
  assert.match(spc, /rf-spc-chart/);
  assert.match(spc, /<option value="cu.temp" selected>/);
  const trace = await env.render(`p=trace&q=${env.store.data().fgBoxes[0].id}`);
  assert.match(trace, /ย้อนกลับไปต้นทาง/);
  assert.match(trace, /rf-node is-hit/);
  const wip = text(await env.render("p=wip"));
  assert.match(wip, /รอรับมอบ/);
  assert.match(wip, /ผสมยาง[\s\S]*ตกแต่งและบรรจุ/, "the stations are the rows of one table");
  assert.equal((wip.match(/รับแล้วรอใช้/g) ?? []).length, 1, "each column name is printed once, not on every station card");
  const warehouse = await env.render("p=warehouse&tab=fg");
  assert.match(warehouse, /data-rf-form="shipBoxes"/);
  assert.match(warehouse, /name="ids\[\]"/);
  const requisition = await env.render("p=requisition");
  assert.match(requisition, /<th class="right">จ่าย \(kg\)<\/th>/, "the detail lists the kilos that were issued");
  assert.match(requisition, /จ่ายครบ รอผสม/, "the status badge says it once; no extra callout repeats it");
  assert.doesNotMatch(requisition, /จ่ายวัตถุดิบครบแล้ว รอห้องผสมนำไปผสม/);
  assert.doesNotMatch(requisition, /<th>สถานะ<\/th>|จ่ายแล้ว<\/span>/, "a requisition that was issued says so once: no status on every line");
  assert.doesNotMatch(requisition, /data-rf-form="weighLine"|data-rf-sim|สถานีชั่ง|data-rf-action="issueRequisition"/, "no weighing station and nothing to issue: the seed has no requisition left on the scale");
  // an old requisition that is still on the scale gets one button for the whole slip
  const old = env.store.data().requisitions.find((row) => row.status === "issued");
  old.status = "weighing";
  old.lines.forEach((line) => { line.actualKg = null; line.weighedAt = null; });
  const legacy = await env.render(`p=requisition&sel=${old.id}`);
  assert.match(legacy, /data-rf-action="issueRequisition"/);
  assert.match(legacy, /เบิกทั้งใบ/);
  assert.match(legacy, /data-rf-action="issueRequisition"[^>]*data-rf-confirm="เบิกทั้งใบ [^"]+"|data-rf-confirm="เบิกทั้งใบ [^"]+"[^>]*data-rf-action="issueRequisition"/, "issuing the whole slip draws the stock down, so it asks first");
  assert.match(legacy, /รอจ่าย/);
  assert.match(legacy, /<th>สถานะ<\/th>/, "the per-line status stays for a slip that is not fully issued");
  assert.doesNotMatch(legacy, /data-rf-form="weighLine"|data-rf-sim|สถานีชั่ง/);
});

test("text from the data is escaped on every page that shows it", async () => {
  const env = load();
  env.store.setUser("U01");
  const now = Date.now();
  const result = env.store.run("createOrder", { recipeId: "RC-EPDM-DS01", customer: XSS, customerPo: XSS, targetQty: 5, startDate: now, dueDate: now + 86400000, note: XSS });
  assert.equal(result.ok, true);
  env.store.run("setOrderStatus", { id: result.result, status: "released" });
  env.store.run("createNcr", { title: XSS, lotId: env.store.data().lots[0].id, stage: "curing", whys: [XSS], containment: XSS });
  const lotNo = env.store.run("receiveMaterial", { materialCode: "ZNO", qtyKg: 1, expiry: now + 86400000, supplier: XSS, location: XSS }).result;
  for (const page of ["dashboard", "orders", "quality&tab=ncr", "warehouse", "audit", `trace&q=${lotNo}`]) {
    const html = await env.render(page === "dashboard" ? "" : `p=${page}`);
    assert.doesNotMatch(html, /<script>/, page);
    assert.match(html, /&lt;script&gt;/, page);
  }
  const scan = env.context.MNP_RUBBERFLOW_DIALOGS.scan(env.ctx(), { code: result.result });
  assert.doesNotMatch(scan.html, /<script>/);
  const tag = env.context.MNP_RUBBERFLOW_DIALOGS.tag(env.ctx(), { kind: "order", id: result.result });
  assert.doesNotMatch(tag.html, /<script>/);
  assert.match(tag.html, /&lt;script&gt;/);
});

test("the requisition dialog sends the purchase dialog the same breakdown: its own need, on hand, reserved, on order and shortage that add up", () => {
  const env = load();
  env.store.setUser("U03");
  const data = env.store.data();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  // the dialog lists only WOs with batches left: take the first of them; its batch count comes from the WO (not typed)
  const recipeOfOrder = (row) => rules.recipeOf(data.recipes, row.recipeId, row.recipeRevision);
  const order = data.orders.find((row) => ["released", "in_progress"].includes(row.status) && rules.nextRequisitionBatches(row, recipeOfOrder(row), data.requisitions) > 0);
  const recipe = recipeOfOrder(order);
  const batches = rules.nextRequisitionBatches(order, recipe, data.requisitions);
  assert.ok(batches >= 1);
  const [first] = rules.recipeLines(recipe);
  for (const lot of data.materialLots) if (lot.materialCode === first.materialCode) lot.qtyKg = 0;
  const opened = [];
  const run = (onOrderKg) => {
    data.purchaseOrders = onOrderKg ? [{ id: "PO-T", status: "ordered", lines: [{ materialCode: first.materialCode, qtyKg: onOrderKg, receivedKg: null }] }] : [];
    const nodes = {
      "[data-rf-order]": { value: order.id, addEventListener() {} }, "[data-rf-batches]": { value: "" }, "[data-rf-submit]": { disabled: false },
      "[data-rf-recipe-line]": {}, "[data-rf-preview]": {}, "[data-rf-shortage]": { innerHTML: "", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } },
    };
    const built = env.context.MNP_RUBBERFLOW_DIALOGS.createRequisition(env.ctx());
    built.bind({ querySelector: (selector) => nodes[selector] }, { openDialog: (name, args) => opened.push([name, args]) });
    assert.match(nodes["[data-rf-shortage]"].innerHTML, /data-rf-po-short/, "the shortage button is offered");
    nodes["[data-rf-shortage]"].handlers.click({ target: { closest: (selector) => (selector === "[data-rf-po-short]" ? {} : null) } });
    const [name, args] = opened.at(-1);
    assert.equal(name, "purchase");
    return args.rows.find((row) => row.materialCode === first.materialCode);
  };
  const plain = run(0);
  const ordered = run(1);
  assert.equal(plain.needKg, Math.ceil(first.kgPerBatch * batches * 1000 - 1e-6) / 1000, "the need is the batches the WO still has to requisition, rounded up at 3 decimals (never less than the requisition issues)");
  assert.equal(ordered.onOrderKg, 1, "the line on order is passed on");
  for (const row of [plain, ordered]) {
    assert.equal(row.availableKg, Math.round((row.onHandKg - row.reservedKg + row.onOrderKg) * 1000) / 1000, "on hand − reserved + on order");
    assert.equal(row.shortageKg, Math.round(Math.max(0, row.needKg - row.availableKg) * 1000) / 1000, "shortage = need − available");
  }
  assert.equal(Math.round((plain.shortageKg - ordered.shortageKg) * 1000) / 1000, 1, "the kilos already on order reduce the shortage");
  assert.equal(Math.round((plain.orderKg - ordered.orderKg) * 1000) / 1000, 1, "and the default order quantity");
});

test("the requisition dialog lists only work orders with batches left, fills the batch count from the WO (read-only, shown once) and shows an empty state when every WO is covered", () => {
  const env = load();
  env.store.setUser("U03");
  const data = env.store.data();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const recipeOfOrder = (row) => rules.recipeOf(data.recipes, row.recipeId, row.recipeRevision);
  const open = data.orders.filter((row) => ["released", "in_progress"].includes(row.status));
  const left = (row) => rules.nextRequisitionBatches(row, recipeOfOrder(row), data.requisitions);
  const covered = open.filter((row) => left(row) === 0);
  const listed = open.filter((row) => left(row) > 0);
  assert.ok(covered.length >= 1 && listed.length >= 1, "the demo has a WO whose requisitions cover it and a WO with batches left");
  const build = () => env.context.MNP_RUBBERFLOW_DIALOGS.createRequisition(env.ctx());
  const html = build().html;
  for (const row of covered) assert.doesNotMatch(html, new RegExp(`value="${row.id}"`), `${row.id} is covered: not listed`);
  for (const row of listed) assert.match(html, new RegExp(`value="${row.id}"`), `${row.id} has batches left: listed`);
  assert.match(html, /data-rf-batches readonly/, "the batch count is not typed");
  assert.equal((html.match(/name="batches"/g) ?? []).length, 1, "shown once");
  // bind: the field shows the WO's remaining batches and follows the selection
  const nodes = {
    "[data-rf-order]": { value: listed[0].id, addEventListener() {} }, "[data-rf-batches]": { value: "" }, "[data-rf-submit]": { disabled: false },
    "[data-rf-recipe-line]": {}, "[data-rf-preview]": {}, "[data-rf-shortage]": { innerHTML: "", addEventListener() {} },
  };
  build().bind({ querySelector: (selector) => nodes[selector] }, {});
  assert.equal(nodes["[data-rf-batches]"].value, String(left(listed[0])));
  // every WO covered: an empty state instead of an empty select, and no submit
  for (const row of data.orders) row.status = "completed";
  const empty = build();
  assert.match(empty.html, /ไม่มีใบสั่งผลิตที่รอเบิกเคมี/);
  assert.doesNotMatch(empty.html, /data-rf-order/);
  assert.match(empty.html, /data-rf-submit[^>]*disabled/);
  empty.bind({ querySelector: () => null }, {});
});

test("every dialog of the prototype builds from the seed, with print documents carrying a Code 39 barcode", () => {
  const env = load();
  env.store.setUser("U01");
  const ctx = env.ctx();
  const dialogs = env.context.MNP_RUBBERFLOW_DIALOGS;
  const data = env.store.data();
  const sendable = data.lots.find((lot) => env.context.MNP_RUBBERFLOW_ACTIONS.transferableQty(lot, Date.now()) > 0);
  const inTransit = data.transfers.find((transfer) => transfer.status === "in_transit");
  const finishing = data.lots.find((lot) => lot.stage === "finishing");
  const cases = [
    ["createOrder", {}, /data-rf-form="createOrder"/], ["createRecipe", {}, /data-rf-form="createRecipe"/], ["receiveMaterial", {}, /data-rf-form="receiveMaterial"/],
    ["createRequisition", {}, /data-rf-form="createRequisition"[^>]*data-rf-success="เบิก \{result\} แล้ว"[\s\S]*data-rf-submit[^>]*>เบิก<\/button>/], ["transfer", { lotId: sendable.id }, /data-rf-form="createTransfer"/], ["receive", { id: inTransit.id }, /data-rf-form="receiveTransfer"/],
    ["qcRecord", { lotId: data.lots[0].id }, /data-rf-form="addQcRecord"[\s\S]*name="values\.hardness"/], ["ncr", {}, /data-rf-form="createNcr"[\s\S]*name="whys\[\]"/],
    ["scan", { code: data.fgBoxes[0].id }, /กล่องสินค้าสำเร็จรูป/], ["alerts", {}, /การแจ้งเตือน/],
    ["tag", { kind: "lot", id: data.lots[0].id }, /rf-barcode/], ["tag", { kind: "box", id: data.fgBoxes[0].id }, /ป้ายติดตามงาน/], ["tag", { kind: "material", id: data.materialLots[0].lotNo }, /ล็อตวัตถุดิบ/],
    ["tag", { kind: "requisition", id: data.requisitions[0].id }, /ใบเบิกวัตถุดิบ/], ["tag", { kind: "transfer", id: data.transfers[0].id }, /ใบส่งมอบ WIP/], ["tag", { kind: "order", id: data.orders[0].id }, /ใบสั่งผลิต/],
    ["coa", { lotId: finishing.id }, /CERTIFICATE OF ANALYSIS[\s\S]*rf-barcode/],
  ];
  for (const [name, args, pattern] of cases) {
    const built = dialogs[name](ctx, args);
    assert.ok(built?.html, name);
    assert.match(built.html, /<dialog class="rf-modal/, name);
    assert.match(built.html, pattern, name);
    assert.doesNotMatch(built.html, /undefined|NaN/, name);
  }
  assert.equal(dialogs.tag(ctx, { kind: "lot", id: "nope" }), null);
  assert.equal(dialogs.transfer(ctx, { lotId: "nope" }), null);
  assert.equal(dialogs.coa(ctx, { lotId: "nope" }), null);
  const barcode = env.context.MNP_RUBBERFLOW_UI.barcode("MX-1");
  assert.match(barcode, /aria-label="บาร์โค้ด MX-1"/);
  assert.ok((barcode.match(/<rect/g) ?? []).length >= 5 * 6, "start, 4 characters and stop, 5 bars each");
});

test("forms and buttons submit through the data-rf-* contract: success saves, toasts and redraws; a broken rule toasts and keeps the state", async () => {
  const env = load();
  env.store.setUser("U03");
  const form = { ...env.root, dataset: { rfForm: "createOrder", rfSuccess: "เปิดใบสั่งผลิต {result} แล้ว" }, handlers: {}, __values: { customer: "ลูกค้า", customerPo: "", recipeId: "RC-EPDM-DS01", targetQty: "12", color: "ดำ", priority: "normal", startDate: "2026-11-01", dueDate: "2026-11-10", note: "" } };
  form.addEventListener = (type, handler) => { form.handlers[type] = handler; };
  env.fakes["form[data-rf-form]"] = [form];
  await env.render("p=orders");
  const before = env.store.data().orders.length;
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(env.store.data().orders.length, before + 1);
  assert.equal(env.store.data().orders[0].startDate, new Date(2026, 10, 1).getTime(), "dates are converted from the input");
  assert.equal(env.log.renders, 1);
  assert.match(env.log.toasts.at(-1)[0], /^เปิดใบสั่งผลิต WO-/);
  assert.equal(JSON.parse(env.storage.get("mnp-rubberflow-v1")).orders.length, before + 1, "persisted in localStorage");
  form.__values = { ...form.__values, targetQty: "" };
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(env.store.data().orders.length, before + 1, "nothing saved");
  assert.deepEqual(env.log.toasts.at(-1), ["กรุณาระบุจำนวนเป้าหมาย", "error"]);
  assert.equal(env.log.renders, 1, "no redraw after a refused action");

  // ปุ่ม action พร้อม confirm และ args
  const button = { ...env.root, dataset: { rfAction: "cleanMold", rfArgs: JSON.stringify({ id: "DIE-DS-01" }), rfConfirm: "ยืนยันว่าได้ทำความสะอาด DIE-DS-01 แล้ว? นับรอบใหม่จากศูนย์" }, textContent: " บันทึกล้างแล้ว ", handlers: {} };
  button.addEventListener = (type, handler) => { button.handlers[type] = handler; };
  env.fakes["[data-rf-action]"] = [button];
  delete env.fakes["form[data-rf-form]"];
  await env.render("p=molds");
  const usage = env.store.data().molds[0].usageSinceClean;
  env.log.confirmAnswer = false;
  await button.handlers.click();
  assert.equal(env.store.data().molds[0].usageSinceClean, usage, "a cancelled dialog runs nothing");
  assert.equal(env.log.renders, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.log.confirms.at(-1))), { title: "ยืนยันว่าได้ทำความสะอาด DIE-DS-01 แล้ว?", message: "นับรอบใหม่จากศูนย์", confirmLabel: "บันทึกล้างแล้ว", danger: false });
  env.log.confirmAnswer = true;
  await button.handlers.click();
  assert.equal(env.store.data().molds[0].usageSinceClean, 0);
  assert.equal(env.log.renders, 2);

  // ฟอร์มค้นหาใส่ q= ลง URL ของหน้าเดิมโดยคงแท็บ
  const search = { ...env.root, handlers: {}, __values: { q: "SMC" } };
  search.addEventListener = (type, handler) => { search.handlers[type] = handler; };
  env.fakes["form[data-rf-search]"] = [search];
  await env.render("p=orders&tab=released");
  search.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/rubberflow?p=orders&tab=released&q=SMC");
  const filtered = text(await env.render("p=orders&q=SMC"));
  assert.match(filtered, /Siam Motor Components/);
  assert.doesNotMatch(filtered, /อีสเทิร์นไฮดรอลิก/);
});

test("switching the persona redraws or leaves for the role's home, the scan form opens the scan dialog, and reset rebuilds the demo", async () => {
  const env = load();
  env.store.setUser("U01");
  const select = { ...env.root, handlers: {} };
  select.addEventListener = (type, handler) => { select.handlers[type] = handler; };
  env.fakes["[data-rf-user]"] = [select];
  await env.render("p=audit");
  select.handlers.change({ target: { value: "U05" } });
  assert.equal(env.store.user().role, "mixer");
  assert.equal(env.log.hash, "#/rubberflow", "a mixer cannot see the audit page, so it goes home");
  assert.equal(env.log.renders, 0);
  select.handlers.change({ target: { value: "U01" } });
  assert.equal(env.log.renders, 1, "a persona that may stay on the page just redraws");

  const scan = { ...env.root, handlers: {}, __values: { code: " mx-1 " }, reset() { this.wasReset = true; } };
  scan.addEventListener = (type, handler) => { scan.handlers[type] = handler; };
  env.fakes["[data-rf-scan]"] = [scan];
  await env.render();
  scan.handlers.submit({ preventDefault() {}, currentTarget: scan });
  assert.equal(scan.wasReset, true);
  assert.match(env.log.dialogs.at(-1), /data-rf-dialog="scan"/);
  assert.match(env.log.dialogs.at(-1), /ไม่พบรหัส “mx-1”/);

  const reset = { ...env.root, handlers: {} };
  reset.addEventListener = (type, handler) => { reset.handlers[type] = handler; };
  env.fakes["[data-rf-reset]"] = [reset];
  env.store.run("cleanMold", { id: "DIE-DS-01" });
  await env.render("p=molds");
  env.log.confirmAnswer = false;
  await reset.handlers.click();
  assert.equal(env.store.data().molds[0].usageSinceClean, 0, "a cancelled reset keeps the data");
  assert.equal(env.log.confirms.at(-1).danger, true);
  env.log.confirmAnswer = true;
  await reset.handlers.click();
  assert.ok(env.store.data().molds[0].usageSinceClean > 0);
  assert.deepEqual(env.log.toasts.at(-1), ["รีเซ็ตข้อมูลสาธิตเรียบร้อย", "ok"]);
});

test("pages carry their module hue, and the side menu, page head and callouts use the shared line icon set", async () => {
  const env = load();
  env.store.setUser("U01");
  const html = await env.render("p=mixing");
  const svg = (name) => env.context.MNP_UI_ICONS.icon(name).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  assert.match(html, /<div class="rf-page" data-module="rf" data-rf-mod="mixing">/);
  assert.match(html, new RegExp(`<header class="rf-pagehead"><div class="rf-pagehead-main"><span class="rf-mod-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${svg("mix")}</span></span><div><h1>`), "the page head shows the module icon before its single h1");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-rf-design/, "no design switcher any more");
  const sub = env.module.nav[0].subnav("rubberflow");
  assert.match(sub, new RegExp(`class="rf-nav-item" data-rf-mod="orders" [^>]*><span class="rf-nav-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${svg("clipboard")}</span></span><span class="rf-nav-text">ใบสั่งผลิต</span>`));
  const gated = await env.render("p=extrusion");
  assert.match(gated, new RegExp(`<div class="rf-callout is-warn" role="note"><span class="rf-callout-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${svg("warning")}</span></span><div class="rf-callout-body"><strong>ด่านรับมอบ:`));
  assert.match(await env.render(), /<div class="rf-page" data-module="rf" data-rf-mod="dashboard">/);
  env.store.setUser(null);
});

test("RubberFlow and BOM stay admin test-mode only: menu, page and test mode all refuse everyone else", async () => {
  // ผู้ใช้ต้องการให้สองโมดูลนี้เห็นเฉพาะ admin ในโหมดทดสอบ จนกว่าจะตัดสินใจเปิดใช้จริง — เทสต์นี้กันการเอาชั้นใดชั้นหนึ่งออกโดยไม่ตั้งใจ
  const { readFileSync } = await import("node:fs");
  // ตัดบรรทัดที่เป็นคอมเมนต์ทิ้งก่อน: โค้ดที่ถูกคอมเมนต์ออกต้องไม่นับว่ายังป้องกันอยู่
  const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const app = read("app.js");
  assert.match(app, /\.filter\(\(item\) => !item\.sandboxOnly \|\| isSandboxMode\(\)\)/, "the side menu drops sandboxOnly items outside test mode");
  assert.match(app, /if \(state\.employee\?\.role\?\.code !== "admin" \|\| state\.employee\.labOnly\) return;/, "only an admin can enter test mode");
  for (const file of ["modules/module-rubberflow.js", "modules/module-bom.js"]) {
    const source = read(file);
    assert.match(source, /if \(!state\.employee\?\.isSandbox\) return renderNotFound\(\);/, `${file} refuses a typed URL outside test mode`);
    assert.match(source, /nav: \[\{[^\]]*sandboxOnly: true/, `${file} keeps its menu test-mode only`);
  }
});

test("two-stage recipe: the recipe form and the mixing station have six stage inputs, the forms send stages, and no recipe or product name is shown", async () => {
  const env = load();
  env.store.setUser("U01");
  const stageInputs = (html) => {
    for (const stage of [1, 2]) {
      for (const key of ["mixerTemp", "dumpTemp", "mixMin"]) assert.match(html, new RegExp(`name="${key}${stage}"`), `${key}${stage}`);
      for (const label of [`อุณหภูมิเครื่องผสม ขั้น ${stage} (°C)`, `อุณหภูมิปล่อยยาง ขั้น ${stage} (°C)`, `เวลาผสม ขั้น ${stage} (นาที)`]) assert.ok(html.includes(label), label);
    }
    assert.doesNotMatch(html, /name="mixSec"|name="name"|name="productName"|เวลาผสม \(s\)/);
  };
  // dialog สร้างสูตร: ช่องของสองขั้น + เลือกขั้นต่อบรรทัดวัตถุดิบ ไม่มีชื่อสูตร/ชื่อสินค้า
  const built = env.context.MNP_RUBBERFLOW_DIALOGS.createRecipe(env.ctx(), {});
  stageInputs(built.html);
  assert.match(built.html, /name="stage\[\]"/, "each material line has a stage select");
  assert.match(built.html, /name="productCode"/);
  // สถานีผสม: หกช่อง + ตารางล็อตแสดงสองขั้น (ข้อมูลสาธิตมีใบเบิกที่จ่ายแล้วรอผสม)
  const mixing = await env.render("p=mixing");
  stageInputs(mixing);
  assert.match(mixing, /ขั้น 1: [\d.]+°C · [\d.]+ นาที/);
  assert.doesNotMatch(mixing, /undefined|NaN/);
  // หน้าสูตร/ใบสั่งผลิต: รหัสสูตร (+ รหัสสินค้า) ไม่มีชื่อ
  const recipes = text(await env.render("p=recipes&sel=RC-EPDM-DS01"));
  assert.match(recipes, /RC-EPDM-DS01 · DS-1825/);
  assert.match(recipes, /ขั้น 1[\s\S]*ขั้น 2/);
  assert.doesNotMatch(recipes, /ซีลยางประตูรถยนต์|EPDM ซีลประตูรถยนต์/);
  const orders = text(await env.render("p=orders"));
  assert.match(orders, /RC-EPDM-DS01 · DS-1825/);
  assert.doesNotMatch(orders, /ซีลยางประตูรถยนต์/);

  // ฟอร์มสูตรส่ง stages และขั้นของบรรทัดผ่าน TRANSFORMS
  const form = { ...env.root, dataset: { rfForm: "createRecipe", rfSuccess: "ok" }, handlers: {}, __values: {
    id: "RC-FORM-01", productCode: "", uom: "m", batchKg: "50", yieldPerKg: "6", restHours: "4", dumpTol: "5",
    mixerTemp1: "80", dumpTemp1: "110", mixMin1: "3", mixerTemp2: "90", dumpTemp2: "130", mixMin2: "2",
    "materialCode[]": ["ZNO", "S-80"], "phr[]": ["5", "2"], "stage[]": ["1", "2"],
  } };
  form.addEventListener = (type, handler) => { form.handlers[type] = handler; };
  env.fakes["form[data-rf-form]"] = [form];
  await env.render("p=recipes");
  await form.handlers.submit({ preventDefault() {} });
  const made = env.store.data().recipes.find((row) => row.id === "RC-FORM-01");
  assert.deepEqual(JSON.parse(JSON.stringify(made.stages)), [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(made.items)), [{ materialCode: "ZNO", phr: 5, stage: 1 }, { materialCode: "S-80", phr: 2, stage: 2 }]);
  assert.equal(made.productCode, "");

  // ฟอร์มผสมส่งหกค่า: ขั้น 2 หลุดช่วง → QC Hold
  const req = env.store.data().requisitions.find((row) => row.status === "issued");
  const recipe = env.store.data().recipes.find((row) => row.id === req.recipeId);
  const mixForm = { ...env.root, dataset: { rfForm: "recordMixing", rfSuccess: "บันทึก {result} แล้ว" }, handlers: {}, __values: {
    reqId: req.id, machine: "BM-02 Banbury 110L", shift: "D", outputKg: "10", scrapKg: "", scrapReason: "",
    mixerTemp1: "80", dumpTemp1: String(recipe.stages[0].dumpTemp), mixMin1: "3",
    mixerTemp2: "90", dumpTemp2: String(recipe.stages[1].dumpTemp + recipe.dumpTol + 2), mixMin2: "2",
  } };
  mixForm.addEventListener = (type, handler) => { mixForm.handlers[type] = handler; };
  env.fakes["form[data-rf-form]"] = [mixForm];
  await env.render("p=mixing");
  await mixForm.handlers.submit({ preventDefault() {} });
  const lot = env.store.data().lots.find((row) => row.stage === "mixing" && row.sources[0].id === req.id);
  assert.equal(lot.qc, "hold");
  assert.match(lot.holdReasons.join(" "), /Dump temp ขั้น 2/);
  assert.doesNotMatch(lot.holdReasons.join(" "), /ขั้น 1/);
  assert.equal(lot.params.stages.length, 2);
});

test("molds can be added and edited from the page (escaped, validated by the action), NCRs offer the corrective / preventive form while open, and the audit page names every action", async () => {
  const env = load();
  env.store.setUser("U01");
  let html = await env.render("p=molds");
  assert.match(html, /data-rf-open="moldEdit"/, "the page offers the add button");
  assert.match(html, /aria-label="แก้ไข DIE-DS-01"/, "and one edit button per mold");
  const dialogs = env.context.MNP_RUBBERFLOW_DIALOGS;
  const add = dialogs.moldEdit(env.ctx());
  assert.match(add.html, /data-rf-form="saveMold"[\s\S]*name="id"[\s\S]*name="name"[\s\S]*name="kind"[\s\S]*name="unit"[\s\S]*name="perCycle"[\s\S]*name="cleanEvery"[\s\S]*name="pmLimit"/);
  assert.doesNotMatch(add.html, /name="usageSinceClean"|name="totalUsage"/, "usage is counted from production, never typed");
  const edit = dialogs.moldEdit(env.ctx(), { id: "DIE-DS-01" });
  assert.match(edit.html, /name="id" value="DIE-DS-01" readonly/);
  assert.match(edit.html, /แก้ไข DIE-DS-01/);
  // the action behind the form (demo mode has no right check; the XSS name is escaped on the page)
  const saved = env.store.run("saveMold", { id: "DIE-X", name: XSS, kind: "die", unit: "m", perCycle: "1", cleanEvery: "100", pmLimit: "1000" });
  assert.equal(saved.ok, true, saved.error?.message);
  html = await env.render("p=molds");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(env.store.run("saveMold", { id: "DIE-X", name: "x", kind: "nope", unit: "m", perCycle: 1, cleanEvery: 1, pmLimit: 1 }).error.message, /ชนิด/);

  // an open NCR carries the fill form (the close form stays with the QC decision); a closed one is read-only text
  const lot = env.store.data().lots[0];
  const ncr = env.store.run("createNcr", { title: "ผิวหยาบ", lotId: lot.id, stage: lot.stage, whys: ["ก"], containment: "ข" }).result;
  html = await env.render("p=quality&tab=ncr");
  assert.match(html, /data-rf-form="updateNcr"[^>]*>[\s\S]*name="corrective"[\s\S]*name="preventive"/);
  assert.equal(env.store.run("updateNcr", { id: ncr, corrective: "ล้างแม่พิมพ์", preventive: "เพิ่มรอบล้าง" }).ok, true);
  assert.equal(env.store.run("closeNcr", { id: ncr, verification: "ok" }).ok, true);
  html = await env.render("p=quality&tab=ncr");
  assert.doesNotMatch(html.split("<section").find((part) => part.includes(ncr)) ?? "", /data-rf-form="updateNcr"/, "a closed NCR has no form");
  assert.match(html, /ล้างแม่พิมพ์/);
  assert.match(env.store.run("updateNcr", { id: ncr, corrective: "x" }).error.message, /ปิดแล้ว/);
  assert.match(env.store.run("updateNcr", { id: "NCR-NOPE", corrective: "x" }).error.message, /ไม่พบ/);

  // the audit page of the database mode has a Thai label for every action the database whitelists
  const source = fs.readFileSync("modules/rubberflow-pages-plan.js", "utf8");
  for (const action of ["receiveMaterial", "setMaterialLotStatus", "createRequisition", "weighLine", "issueRequisition", "recordMixing", "endRest", "recordExtrusion", "recordCuring", "recordFinishing", "createTransfer", "receiveTransfer", "shipBoxes", "addQcRecord", "createNcr", "updateNcr", "closeNcr", "cleanMold", "saveMold"]) {
    assert.match(source, new RegExp(`\\b${action}: "`), action);
  }
  assert.match(source, /molds: "แม่พิมพ์"/);
});

test("the closing dialog of a work order asks for a produced quantity in the demo only; the database counts it from the finishing lots", async () => {
  const env = load();
  env.store.setUser("U01");
  const order = env.store.data().orders.find((row) => row.status === "in_progress");
  const demo = env.context.MNP_RUBBERFLOW_DIALOGS.closeOrder(env.ctx("p=orders"), { id: order.id });
  assert.match(demo.html, /name="producedQty"/);
  // a store that says it is on the database (stub of the three methods the dialog reads)
  const remoteCtx = { ...env.ctx("p=orders"), store: { isRemote: () => true } };
  const remote = env.context.MNP_RUBBERFLOW_DIALOGS.closeOrder(remoteCtx, { id: order.id });
  assert.doesNotMatch(remote.html, /name="producedQty"/);
  assert.match(remote.html, /data-rf-form="setOrderStatus"/);
});

test("purchasing screens: the check opens one dialog (escaped, safety stock and order quantity editable), the form creates the order, the warehouse tab lists it and the receive dialog closes a line", async () => {
  const env = load();
  env.store.setUser("U03");
  const DAY = 86400000;
  const now = Date.now();
  const { MNP_RUBBERFLOW: module, MNP_RUBBERFLOW_DIALOGS: dialogs, MNP_RUBBERFLOW_PAGES: pages } = env.context;
  const big = env.store.run("createOrder", { recipeId: "RC-EPDM-DS01", customer: "ลูกค้า", targetQty: 600000, startDate: now, dueDate: now + DAY });
  assert.equal(big.ok, true, big.error?.message);

  // auto check with a shortage opens the dialog; the PI number is escaped
  const opened = await module.checkMaterials({ woIds: [big.result], sourcePi: XSS, skippedJobs: 2, auto: true });
  assert.equal(opened.opened, true);
  const html = env.log.dialogs.at(-1);
  assert.match(html, /data-rf-dialog="purchase"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /data-rf-form="createPurchaseOrder"/);
  assert.match(html, /ไม่ได้นับ 2 งานที่ยังไม่มี WO หรือไม่มีสูตร/);
  for (const name of ["materialCode[]", "needKg[]", "availableKg[]", "shortageKg[]", "safetyKg[]", "qtyKg[]"]) assert.ok(html.includes(`name="${name}"`), name);
  for (const code of ["EPDM-55", "CB-N550", "ZNO"]) assert.ok(html.includes(`>${code}<`) || html.includes(`value="${code}"`), code);
  assert.match(html, /สต็อกขั้นต่ำ \(kg\)/);
  assert.match(html, />สั่งซื้อ<\/button>/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.equal(env.log.toasts.length, 0, "no toast when the dialog opens");

  // the dialog factory used directly: nothing to check shows the empty note and no order button
  const empty = dialogs.purchase(env.ctx(), { woIds: ["WO-NONE"] });
  assert.match(empty.html, /ไม่มีวัตถุดิบให้ตรวจ/);
  assert.doesNotMatch(empty.html, /form="rf-purchase"/);
  // rows from a requisition shortage: the safety stock comes from the material, the default order is shortage + safety
  env.store.run("saveMaterial", { code: "ZNO", name: "ซิงค์ออกไซด์", safetyKg: "4" });
  const fromRequisition = dialogs.purchase(env.ctx(), { rows: [{ materialCode: "ZNO", needKg: 10, availableKg: 6, shortageKg: 4 }], note: "ขาดจากใบเบิก" });
  assert.match(fromRequisition.html, /name="safetyKg\[\]"[^>]*value="4"/);
  assert.match(fromRequisition.html, /name="qtyKg\[\]"[^>]*value="8"/);
  assert.match(fromRequisition.html, /ขาดจากใบเบิก/);
  assert.match(fromRequisition.html, /<td class="right muted">-<\/td>/, "a part the requisition shortage does not know is shown as a dash");
  // the stock status is separate columns (need, on hand, reserved, on order) + shortage; the signed "available" is not a column any more
  for (const label of ["ต้องใช้ (kg)", "คงเหลือในคลัง (kg)", "จองแล้ว (kg)", "สั่งค้างรับ (kg)", "ขาด (kg)"]) assert.ok(html.includes(`>${label}</th>`), label);
  assert.doesNotMatch(html, /พร้อมใช้ \(kg\)/);
  assert.match(html, /<th class="right" title="[^"]+">จองแล้ว \(kg\)<\/th>/, "the header explains what is reserved in a tooltip");
  // reserved by old open requisitions and by other open WOs is one column with the split in a tooltip; the signed balance (on hand − reserved + on order) stays stored for the order line
  const crowded = dialogs.purchase(env.ctx(), { rows: [{ materialCode: "ZNO", needKg: 225.598, onHandKg: 100, reservedKg: 260.787, requisitionKg: 5, otherNeedKg: 255.787, onOrderKg: 0, availableKg: -160.787, shortageKg: 386.385 }] });
  assert.ok(crowded.html.includes('<td class="right rf-mono">100.000</td>'), "on hand");
  assert.match(crowded.html, /<td class="right rf-mono" title="ใบเบิกเก่าที่ค้างจ่าย 5\.000 \+ WO อื่นที่ยังไม่ได้เบิก 255\.787">260\.787<\/td>/);
  assert.ok(crowded.html.includes('name="availableKg[]" value="-160.787"'), "signed value stored");
  assert.ok(!crowded.html.includes(">-160.787</td>"), "and not shown as a column");

  // submitting the form: lines, the safety stock to the material, the PI number from the form args
  const form = { ...env.root, dataset: { rfForm: "createPurchaseOrder", rfSuccess: "สั่งซื้อ {result} แล้ว", rfArgs: JSON.stringify({ sourcePi: "PI-9", sourceRequisition: "", note: "" }) }, handlers: {}, __values: {
    "materialCode[]": ["EPDM-55", "ZNO"], "needKg[]": ["50", "10"], "availableKg[]": ["10", "6"], "shortageKg[]": ["40", "4"], "safetyKg[]": ["20", "4"], "qtyKg[]": ["60", "0"],
  } };
  form.addEventListener = (type, handler) => { form.handlers[type] = handler; };
  env.fakes["form[data-rf-form]"] = [form];
  await env.render("p=warehouse&tab=po");
  await form.handlers.submit({ preventDefault() {} });
  assert.deepEqual(env.log.toasts.filter(([, kind]) => kind === "error"), []);
  const [po] = env.store.data().purchaseOrders;
  assert.match(po.id, /^PO-\d{8}-01$/);
  assert.equal(JSON.stringify(po.lines.map((line) => [line.materialCode, line.qtyKg, line.safetyKg, line.shortageKg])), JSON.stringify([["EPDM-55", 60, 20, 40]]), "the zero quantity is not ordered");
  assert.equal(po.sourcePi, "PI-9");
  assert.equal(env.store.data().materials.find((row) => row.code === "EPDM-55").safetyKg, 20, "the safety stock goes to the material");
  assert.match(env.log.toasts.at(-1)[0], /^สั่งซื้อ PO-\d{8}-01 แล้ว$/);
  delete env.fakes["form[data-rf-form]"];

  // the warehouse tab: the open order first with its receive button and cancel button, the tab counts open orders
  let page = await env.render("p=warehouse&tab=po");
  assert.match(page, /ใบสั่งซื้อ \(1\)/);
  assert.ok(page.includes(po.id));
  assert.match(page, /data-rf-open="receivePurchase"/);
  assert.match(page, /data-rf-action="cancelPurchaseOrder"/);
  assert.match(page, /ตรวจสอบรับเข้า/);
  assert.doesNotMatch(page, /undefined|NaN/);
  // the buttons follow the rights of the account (the database decides for real)
  const wh = pages.warehouse({ ...env.ctx("p=warehouse&tab=po"), can: (right) => right !== "receiveMaterial" && right !== "cancelPurchase" }).html;
  assert.doesNotMatch(wh, /data-rf-open="receivePurchase"|cancelPurchaseOrder/);
  assert.ok(wh.includes(po.id), "read-only accounts still see the order");
  // the materials tab and the material form carry the new fields
  page = await env.render("p=warehouse&tab=materials");
  assert.match(page, /สต็อกขั้นต่ำ \(kg\)/);
  assert.match(page, /อายุการเก็บ \(วัน\)/);
  const material = dialogs.materialEdit(env.ctx(), { code: "EPDM-55" }).html;
  assert.match(material, /name="safetyKg"[^>]*value="20"/);
  assert.match(material, /name="shelfLifeDays"[^>]*value="180"/);

  // the receive dialog: ordered quantity, expiry = today + shelf life
  env.store.run("saveMaterial", { code: "EPDM-55", name: "ยาง EPDM", shelfLifeDays: "90" });
  const receive = dialogs.receivePurchase(env.ctx(), { id: po.id, materialCode: "EPDM-55" });
  assert.match(receive.html, /data-rf-form="receivePurchaseLine"/);
  assert.match(receive.html, /name="qtyKg"[^>]*value="60"/);
  assert.match(receive.html, new RegExp(`name="expiry"[^>]*value="${env.context.MNP_RUBBERFLOW_RULES.toInputDate(now + 90 * DAY)}"`));
  assert.ok(receive.html.includes('title="ตั้งต้น = วันนี้ + อายุการเก็บ 90 วัน"'),"the starting point of the expiry is a tooltip");
  // each fact once: the order number is the title only (no row, no placeholder), the ordered quantity is the field's value, no permanent hint text
  assert.ok(receive.html.includes(`ตรวจสอบรับเข้า · ${po.id}`), "the title carries the order number");
  assert.ok(!receive.html.includes(`>${po.id}<`), "no visible row repeats the order number");
  assert.doesNotMatch(receive.html, /สั่งไว้|rf-hint|placeholder|>ใบสั่งซื้อ</);
  assert.match(receive.html, /name="supplier"[^>]*title="เว้นว่าง = ใช้เลขใบสั่งซื้อ"/);
  assert.equal(dialogs.receivePurchase(env.ctx(), { id: po.id, materialCode: "ZNO" }), null, "a material that is not on the order");
  assert.equal(dialogs.receivePurchase(env.ctx(), { id: "PO-NOPE", materialCode: "ZNO" }), null);
  const receiveForm = { ...env.root, dataset: { rfForm: "receivePurchaseLine", rfSuccess: "รับเข้าล็อต {result} แล้ว", rfArgs: JSON.stringify({ id: po.id, materialCode: "EPDM-55" }) }, handlers: {}, __values: { qtyKg: "58", expiry: "2027-06-30", supplier: "" } };
  receiveForm.addEventListener = (type, handler) => { receiveForm.handlers[type] = handler; };
  env.fakes["form[data-rf-form]"] = [receiveForm];
  await env.render("p=warehouse&tab=po");
  await receiveForm.handlers.submit({ preventDefault() {} });
  const lot = env.store.data().materialLots.find((row) => row.supplier === po.id);
  assert.deepEqual([lot.materialCode, lot.qtyKg, lot.expiry], ["EPDM-55", 58, new Date(2027, 5, 30).getTime()]);
  assert.equal(env.store.data().purchaseOrders[0].status, "received");
  assert.match(env.log.toasts.at(-1)[0], /^รับเข้าล็อต RM-EPDM-55-\d{8}-\d\d แล้ว$/);
  delete env.fakes["form[data-rf-form]"];
  page = text(await env.render("p=warehouse&tab=po"));
  assert.match(page, /รับครบแล้ว/);
  assert.ok(page.includes(lot.lotNo));
  assert.doesNotMatch(page, /รอรับ/, "no open line is left");

  // enough stock: only a short note, no dialog
  for (const row of env.store.data().materials) env.store.run("receiveMaterial", { materialCode: row.code, qtyKg: 1e7, expiry: now + 365 * DAY });
  const small = env.store.run("createOrder", { recipeId: "RC-EPDM-DS01", customer: "ลูกค้า", targetQty: 6, startDate: now, dueDate: now + DAY });
  const dialogsBefore = env.log.dialogs.length;
  const quiet = await module.checkMaterials({ woIds: [small.result], sourcePi: "PI-OK", auto: true });
  assert.equal(quiet.opened, false);
  assert.equal(env.log.dialogs.length, dialogsBefore, "no dialog when nothing is short");
  assert.equal(env.log.toasts.at(-1)[0], "เคมีพอสำหรับ WO ที่เปิด");
  // the button of the PI page opens it anyway
  const manual = await module.checkMaterials({ woIds: [small.result], sourcePi: "PI-OK", auto: false });
  assert.equal(manual.opened, true);
  assert.match(env.log.dialogs.at(-1), /สั่งซื้อวัตถุดิบ · PI-OK/);
});

test("the material check refuses accounts that may not order, and says nothing when no WO can be counted", async () => {
  const env = load();
  const { MNP_RUBBERFLOW: module } = env.context;
  assert.equal((await module.checkMaterials({ woIds: ["WO-1"], auto: true })).reason, "rights", "no persona chosen");
  env.store.setUser("U03");
  const before = env.log.toasts.length;
  const none = await module.checkMaterials({ woIds: ["WO-NONE"], sourcePi: "PI-0", auto: true });
  assert.equal(none.opened, false);
  assert.equal(env.log.toasts.length, before, "nothing countable: no 'enough' claim");
});

test("purchasing with purchased parts: the dialog adds a part table after the chemicals (unit shown, same form), a part order line is listed with its unit and received by quantity only", async () => {
  const env = load();
  env.store.setUser("U03");
  const { MNP_RUBBERFLOW_DIALOGS: dialogs, MNP_RUBBERFLOW_PAGES: pages } = env.context;
  const parts = { rows: [
    { itemCode: "P-BOX-01", name: "กล่องนอก <b>", uom: "box", needQty: 7, onHandQty: 5, reservedQty: 0, onOrderQty: 0, shortage: 2, safetyQty: 10, orderQty: 12 },
    { itemCode: "P-STK-01", name: "สติ๊กเกอร์", uom: "pcs", needQty: 120, onHandQty: 400, reservedQty: 0, onOrderQty: 0, shortage: 0, safetyQty: 0, orderQty: 0 },
  ], anyShort: true };
  const ctx = { ...env.ctx("p=orders"), bomPartNeeds: (pi) => (pi === "PI-9" ? parts : null) };
  const dialog = dialogs.purchase(ctx, { woIds: [], sourcePi: "PI-9" }).html;
  assert.match(dialog, /สั่งซื้อวัตถุดิบและของซื้อ · PI-9/);
  assert.doesNotMatch(dialog, /ไม่มีวัตถุดิบให้ตรวจ/, "parts alone are enough to order");
  assert.match(dialog, /ของซื้อ \(ตามหน่วยของชิ้น\)/);
  assert.match(dialog, /กล่องนอก &lt;b&gt; · box/, "the name is escaped and the unit is next to it (the code when the BOM rules are not loaded)");
  assert.ok(dialog.includes('name="source[]" value="bom"') && dialog.includes('name="uom[]" value="box"'), "part rows post their source and unit");
  assert.ok(dialog.includes('name="availableKg[]" value="5"'), "the stored availability of a part is on hand - reserved + on order");
  assert.match(dialog, /name="qtyKg\[\]"[^>]*value="12"/, "the default quantity is the shortage plus the safety stock");
  assert.doesNotMatch(dialog, /undefined|NaN/);
  assert.equal((dialog.match(/data-rf-po-row/g) ?? []).length, 2, "both parts are rows of the one form");
  const plannerDialog = dialogs.purchase({ ...ctx, user: { ...ctx.user, planner: true } }, { woIds: [], sourcePi: "PI-9" }).html;
  assert.doesNotMatch(plannerDialog, /name="safetyKg\[\]"[^>]*readonly/, "a planner edits the safety stock of a part");
  assert.ok(dialog.includes('name="storedSafetyKg[]" value="10"'), "the stored value travels with the row");
  // สมาชิก RB: สต็อกขั้นต่ำของซื้อแก้ไม่ได้ (ช่องอ่านอย่างเดียว) · ของเคมียังแก้ได้
  assert.equal((dialog.match(/name="safetyKg\[\]"[^>]*readonly/g) ?? []).length, 2, "both part rows are read-only for an RB member (the test account is not a planner)");
  // ไม่มีข้อมูลของซื้อ (BOM ไม่ได้โหลด) หรือเปิดจากใบเบิก: ไม่มีตารางของซื้อ
  assert.doesNotMatch(dialogs.purchase(ctx, { woIds: [], sourcePi: "PI-OTHER" }).html, /ของซื้อ \(ตามหน่วยของชิ้น\)/);
  assert.doesNotMatch(dialogs.purchase(ctx, { rows: [{ materialCode: "ZNO", needKg: 1, availableKg: 0, shortageKg: 1 }], sourcePi: "PI-9" }).html, /ของซื้อ \(ตามหน่วยของชิ้น\)/);

  // the form posts chemicals and parts together
  const posted = env.store.run("createPurchaseOrder", {
    lines: [{ materialCode: "ZNO", needKg: 10, availableKg: 6, shortageKg: 4, qtyKg: 5 }, { materialCode: "P-BOX-01", source: "bom", uom: "box", needKg: 7, availableKg: 5, shortageKg: 2, safetyKg: 10, qtyKg: 12 }],
    safety: { ZNO: 4, "P-BOX-01": 10 }, sourcePi: "PI-9",
  });
  assert.equal(posted.ok, true, posted.error?.message);

  // the order list shows the unit and no lot line for the part, the receive dialog asks the quantity only
  const po = env.store.data().purchaseOrders[0];
  const list = text(pages.warehouse({ ...env.ctx("p=warehouse&tab=po") }).html);
  assert.match(list, /P-BOX-01[^]*12\.00 box/);
  assert.match(list, /ZNO[^]*5\.00 kg/);
  const receive = dialogs.receivePurchase(env.ctx("p=warehouse&tab=po"), { id: po.id, materialCode: "P-BOX-01" }).html;
  assert.match(receive, /ปริมาณที่รับจริง \(box\)/);
  assert.doesNotMatch(receive, /name="expiry"|name="supplier"/, "no expiry or supplier for a part");
  assert.match(receive, /data-rf-success="รับเข้า \{result\} แล้ว"/);
  const chem = dialogs.receivePurchase(env.ctx("p=warehouse&tab=po"), { id: po.id, materialCode: "ZNO" }).html;
  assert.match(chem, /name="expiry"/, "a chemical line still asks the expiry");
  const received = env.store.run("receivePurchaseLine", { id: po.id, materialCode: "P-BOX-01", qtyKg: 11 });
  assert.equal(received.ok, true, received.error?.message);
  assert.match(text(pages.warehouse({ ...env.ctx("p=warehouse&tab=po") }).html), /11\.00 box/);
  assert.equal(dialogs.receivePurchase(env.ctx("p=warehouse&tab=po"), { id: po.id, materialCode: "P-BOX-01" }), null, "a received line has no receive dialog");
});

// ---------- ฟอร์ม RubberFlow/BOM: novalidate + ข้อความไทยใต้ช่อง ----------
// กล่องจำลองแค่พอให้ ui.formErrors อ่านได้: ช่อง (input/select) อยู่ใน .field ที่มี label
const fakeForm = (specs) => {
  const controls = specs.map(({ tag = "INPUT", type = "text", name = "x", value = "", required = false, attrs = {}, label = "", marked = false, badInput = false, disabled = false, readOnly = false, role = null, hiddenAncestor = false }) => {
    const container = { dataset: {}, querySelector: (selector) => (selector === "label" ? (label ? { textContent: label } : null) : selector === ".field-required" && marked ? {} : null) };
    const all = { ...attrs, ...(role ? { role } : {}) };
    return { tagName: tag, type, name, value, required, disabled, readOnly, validity: { badInput }, getAttribute: (key) => (key in all ? all[key] : null), closest: (selector) => (selector === ".field" ? container : null), parentElement: { closest: () => (hiddenAncestor ? {} : null) }, container };
  });
  return { dataset: {}, controls, querySelectorAll: () => controls, addEventListener() {} };
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const withSteps = () => {
  const env = load();
  vm.runInContext(fs.readFileSync("modules/form-steps.js", "utf8"), env.context, { filename: "modules/form-steps.js" });
  return env;
};

test("every form of RubberFlow and BOM is novalidate, so the browser never shows its English bubble", () => {
  const files = ["modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js", "modules/bom-pages.js", "modules/module-bom.js"];
  let count = 0;
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (/^\s*\/\//.test(line)) continue;
      for (const tag of line.match(/<form\b[^>]*/g) ?? []) {
        count += 1;
        assert.match(tag, /\bnovalidate\b/, `${file}: ${tag.slice(0, 80)}`);
      }
    }
  }
  assert.ok(count > 40, "the scan found the forms");
  const env = load();
  assert.match(env.context.MNP_RUBBERFLOW_DIALOGS.createOrder(env.ctx()).html, /<form novalidate data-rf-form="createOrder"/);
});

test("form checks: Thai messages for required, number, range and step, one per field, every field at once, in screen order", () => {
  const env = withSteps();
  const { MNP_RUBBERFLOW_UI: ui } = env.context;
  const errors = (specs) => plain(ui.formErrors(fakeForm(specs)));
  const messages = (specs) => errors(specs).map((error) => error.message);

  assert.deepEqual(messages([{ name: "customer", required: true, label: "ลูกค้า (จำเป็น)" }]), ["กรุณาระบุลูกค้า"]);
  assert.deepEqual(messages([{ tag: "SELECT", name: "recipeId", required: true, label: "สินค้า / สูตร (เฉพาะสูตรที่อนุมัติแล้ว) (จำเป็น)" }]), ["กรุณาเลือกสินค้า / สูตร"]);
  assert.deepEqual(messages([{ name: "customer", required: true, value: "   ", label: "ลูกค้า" }]), ["กรุณาระบุลูกค้า"], "blanks are empty");
  // ตัวเลข: ว่าง / ไม่ใช่ตัวเลข / ต่ำกว่า min / เกิน max / ไม่ลงขั้น
  const number = (value, extra = {}) => ({ type: "number", name: "n", label: "จำนวนเป้าหมาย (m) (จำเป็น)", required: true, value, attrs: { min: "1", max: "1000", step: "any" }, ...extra });
  assert.deepEqual(messages([number("")]), ["กรุณาระบุจำนวนเป้าหมาย"]);
  assert.deepEqual(messages([number("", { badInput: true })]), ["จำนวนเป้าหมายต้องเป็นตัวเลข"]);
  assert.deepEqual(messages([number("0")]), ["จำนวนเป้าหมายต้องไม่น้อยกว่า 1"]);
  assert.deepEqual(messages([number("1001")]), ["จำนวนเป้าหมายต้องไม่เกิน 1000"]);
  assert.deepEqual(messages([number("12.5")]), [], "step any takes decimals");
  assert.deepEqual(messages([number("12.5", { attrs: { min: "1" } })]), ["จำนวนเป้าหมายต้องเป็นจำนวนเต็ม"], "no step attribute = whole numbers, as the browser did");
  assert.deepEqual(messages([number("2", { attrs: { min: "1", step: "1" } })]), []);
  assert.deepEqual(messages([number("0.00005", { attrs: { min: "0.0001", step: "any" } })]), ["จำนวนเป้าหมายต้องไม่น้อยกว่า 0.0001"]);
  assert.deepEqual(messages([{ type: "number", name: "m", label: "อายุการเก็บ", value: "" }]), [], "an empty optional number is fine");
  // ช่องไม่ต้องตรวจ: ปิดใช้ / อ่านอย่างเดียว / ตัวแทนของ select ค้นหาได้ / อยู่ในส่วนที่ซ่อน / ซ่อนด้วยปฏิทินแต่เป็นวันที่ที่ label ระบุจำเป็น
  assert.deepEqual(messages([{ name: "a", required: true, disabled: true }, { name: "b", required: true, readOnly: true }, { name: "c", required: true, role: "combobox" }, { name: "d", required: true, hiddenAncestor: true }]), []);
  assert.deepEqual(messages([{ type: "date", name: "startDate", label: "วันเริ่มผลิต (จำเป็น)", marked: true }]), ["กรุณาเลือกวันเริ่มผลิต"], "the Thai calendar drops required, the (จำเป็น) mark still counts");
  assert.deepEqual(messages([{ type: "date", name: "due", label: "วันกำหนดส่ง" }]), [], "a date without the mark stays optional");
  // ช่องที่ไม่มี label (ช่องในตาราง): ใช้ aria-label แล้วข้อความกลาง ๆ
  assert.deepEqual(messages([{ type: "number", name: "qty[]", value: "-1", attrs: { min: "0", step: "any", "aria-label": "สต็อกขั้นต่ำ B25" } }]), ["สต็อกขั้นต่ำ B25ต้องไม่น้อยกว่า 0"]);
  assert.deepEqual(messages([{ name: "z", required: true }]), ["กรุณาระบุข้อมูลในช่องนี้"]);

  // ทุกช่องพร้อมกัน เรียงตามหน้าจอ ช่องละข้อความเดียว (ผิดทั้งว่างและเกินช่วงก็บอกข้อแรก)
  const all = errors([{ name: "customer", required: true, label: "ลูกค้า" }, number("", { name: "targetQty", label: "จำนวน" }), number("5000", { label: "ปริมาณ" }), { name: "ok", value: "x", required: true, label: "ผ่าน" }]);
  assert.deepEqual(all.map((error) => error.message), ["กรุณาระบุลูกค้า", "กรุณาระบุจำนวน", "ปริมาณต้องไม่เกิน 1000"]);
  const form = fakeForm([{ name: "a", required: true, label: "ก" }, { name: "b", required: true, label: "ข" }]);
  assert.deepEqual(plain(ui.formErrors(form)).map((error) => error.name), form.controls.map((control) => control.container.dataset.field), "each message targets its field box");
});

test("submit check: a bad form shows the errors under the fields and focuses the first; a good form clears them and goes on to the action", () => {
  const env = withSteps();
  const { MNP_RUBBERFLOW_UI: ui } = env.context;
  const calls = [];
  const real = env.context.MNP_FORM_STEPS;
  const focus = [];
  const target = { focus: (options) => focus.push(options), closest: () => null };
  env.context.MNP_FORM_STEPS = { ...real, showFieldErrors: (form, errors) => { calls.push(["show", errors.map((error) => error.message)]); return target; }, clearFieldErrors: () => calls.push(["clear"]), clearFieldError: (form, name) => calls.push(["clearOne", name]) };
  const handlers = {};
  const form = { ...fakeForm([{ name: "customer", required: true, label: "ลูกค้า" }]), addEventListener: (type, handler) => { handlers[type] = handler; } };
  assert.equal(ui.validateForm(form), false);
  assert.deepEqual(plain(calls), [["show", ["กรุณาระบุลูกค้า"]]]);
  assert.deepEqual(plain(focus), [{ preventScroll: true }], "the first invalid field gets the focus");
  // แก้ช่องแล้วข้อความของช่องนั้นหาย
  handlers.input({ target: { closest: () => ({ dataset: { field: "rf-field-1" } }) } });
  assert.deepEqual(plain(calls.at(-1)), ["clearOne", "rf-field-1"]);
  form.controls[0].value = "ลูกค้า";
  calls.length = 0;
  assert.equal(ui.validateForm(form), true);
  assert.deepEqual(plain(calls), [["clear"]]);
  // ไม่มีตัวช่วยกลาง (ไม่ได้โหลด form-steps.js): ไม่ขวาง action ที่ตรวจเองอยู่แล้ว
  env.context.MNP_FORM_STEPS = undefined;
  assert.equal(ui.validateForm(fakeForm([{ name: "customer", required: true }])), true);
});

test("an empty overview points at the first step; the station gates and the mixing station lead to the page that unblocks them", async () => {
  const env = load();
  env.store.setUser("U01");
  const { MNP_RUBBERFLOW_PAGES: pages } = env.context;
  const base = env.ctx("p=dashboard");
  const html = (ctx) => pages.dashboard(ctx).html;
  assert.doesNotMatch(html(base), /data-rf-open="createOrder"/, "with orders on the page there is no start button");
  const empty = (extra = {}) => ({ ...base, data: { ...base.data, orders: [], lots: [], transfers: [], ...extra } });
  assert.match(html(empty()), /data-rf-open="createOrder"[^>]*>เปิดใบสั่งผลิต</, "no orders yet: one primary action opens the order form");
  assert.match(html(empty({ recipes: [] })), /href="[^"]*recipes[^"]*"[^>]*>สร้างสูตรยาง</, "no approved recipe: go and make one first");
  assert.doesNotMatch(html(empty({ recipes: [] })), /data-rf-open="createOrder"/);

  // ด่านรับมอบที่ไม่มีใบรอรับ: ไปสถานีก่อนหน้า · ห้องผสมที่ไม่มีใบเบิกจ่าย: ไปหน้าเบิกเคมี
  const gate = pages.extrusion({ ...base, data: { ...base.data, transfers: [] } }).html;
  assert.match(gate, /ด่านรับมอบ[\s\S]*href="[^"]*mixing[^"]*"[^>]*>ไปสถานีผสมยาง</);
  const waiting = pages.extrusion({ ...base, data: { ...base.data, transfers: [{ id: "T-1", to: "extrusion", status: "in_transit", remaining: 5, lotId: "L", uom: "m", orderId: "O" }] } }).html;
  assert.match(waiting, /ไปหน้ารับมอบ/);
  assert.doesNotMatch(waiting, /ไปสถานีผสมยาง/, "a waiting transfer keeps its own link");
  const mixing = pages.mixing({ ...base, data: { ...base.data, requisitions: [] } }).html;
  assert.match(mixing, /ต้องเบิกเคมีก่อน[\s\S]*href="[^"]*requisition[^"]*"[^>]*>ไปหน้าเบิกเคมี</);
  // บัญชีที่เปิดหน้านั้นไม่ได้ไม่เห็นลิงก์ (ไม่พาไปหน้าที่ถูกปฏิเสธ)
  env.store.setUser("U06");
  const own = env.ctx("p=extrusion");
  assert.equal(own.canSee("mixing"), false, "the extruder has no mixing page");
  assert.doesNotMatch(pages.extrusion({ ...own, data: { ...own.data, transfers: [] } }).html, /ไปสถานีผสมยาง/);
});

test("the order form: no approved recipe = an explanation, a link to the recipes and a disabled save; otherwise the recipe select is required", () => {
  const env = load();
  env.store.setUser("U01");
  const { MNP_RUBBERFLOW_DIALOGS: dialogs } = env.context;
  const base = env.ctx("p=orders");
  const withRecipes = dialogs.createOrder(base).html;
  assert.match(withRecipes, /<select[^>]*name="recipeId"[^>]*\brequired\b/, "the recipe select is required (the form check turns an empty choice into a Thai field error)");
  assert.match(withRecipes, /<option value="">เลือกสินค้า \/ สูตร<\/option>/, "an empty choice exists so the required rule can fire");
  assert.doesNotMatch(withRecipes, /ยังไม่มีสูตรที่อนุมัติ/);
  assert.doesNotMatch(withRecipes, /type="submit"[^>]*\bdisabled\b/);
  // ไม่มีสูตรที่อนุมัติ: ไม่มีช่องเลือกที่ว่างเปล่า
  const none = { ...base, data: { ...base.data, recipes: base.data.recipes.filter((recipe) => recipe.status !== "approved") } };
  const html = dialogs.createOrder(none).html;
  assert.doesNotMatch(html, /name="recipeId"/, "no empty select");
  assert.match(html, /ยังไม่มีสูตรที่อนุมัติ/);
  assert.match(html, /href="[^"]*recipes[^"]*" data-rf-close>ไปที่สูตรยาง</, "a link to the recipe page that closes the dialog first");
  assert.match(html, /<button[^>]*type="submit"[^>]*\bdisabled\b[^>]*>บันทึกใบสั่งผลิต</, "the save button is disabled");
});

test("list empty states: nothing yet says so and offers the first step, a search that finds nothing says not found", () => {
  const env = load();
  env.store.setUser("U01");
  const { MNP_RUBBERFLOW_PAGES: pages } = env.context;
  const base = env.ctx("p=orders");
  const orders = (ctx) => pages.orders(ctx).html;
  const noOrders = { ...base, data: { ...base.data, orders: [] } };
  const empty = orders(noOrders);
  assert.match(empty, /ยังไม่มีใบสั่งผลิต/);
  assert.doesNotMatch(empty, /ไม่พบใบสั่งผลิต/);
  assert.equal((empty.match(/data-rf-open="createOrder"/g) ?? []).length, 1, "the one action sits in the empty state, not twice");
  assert.match(empty, /class="empty-state"><p>ยังไม่มีใบสั่งผลิต<\/p><button[^>]*data-rf-open="createOrder"/);
  // ยังไม่มีสูตรที่อนุมัติ: ไปสร้างสูตรก่อน
  const noRecipe = orders({ ...noOrders, data: { ...noOrders.data, recipes: [] } });
  assert.match(noRecipe, /href="[^"]*recipes[^"]*"[^>]*>สร้างสูตรยาง</);
  assert.doesNotMatch(noRecipe, /data-rf-open="createOrder"/);
  // ค้นหาแล้วไม่เจอ (มีใบอยู่): ไม่พบ · ปุ่มเปิดใบอยู่ที่หัวหน้า
  const searched = orders(env.ctx("p=orders&q=zzzz-no-match"));
  assert.match(searched, /ไม่พบใบสั่งผลิต/);
  assert.doesNotMatch(searched, /ยังไม่มีใบสั่งผลิต/);
  assert.equal((searched.match(/data-rf-open="createOrder"/g) ?? []).length, 1);
  // ผู้ที่เปิดใบไม่ได้ไม่เห็นปุ่มในสถานะว่าง
  env.store.setUser("U06");
  const viewer = env.ctx("p=orders");
  const viewerHtml = orders({ ...viewer, data: { ...viewer.data, orders: [] } });
  assert.match(viewerHtml, /ยังไม่มีใบสั่งผลิต/);
  assert.doesNotMatch(viewerHtml, /data-rf-open="createOrder"|สร้างสูตรยาง/);
  // คลัง: ค้นหาไม่เจอ = ไม่พบ · ยังว่างเฉยๆ = ยังไม่มี
  env.store.setUser("U01");
  const warehouse = (query, data = {}) => { const ctx = env.ctx(query); return pages.warehouse({ ...ctx, data: { ...ctx.data, ...data } }).html; };
  assert.match(warehouse("p=warehouse&tab=raw", { materialLots: [] }), /ยังไม่มีล็อตวัตถุดิบ/);
  assert.match(warehouse("p=warehouse&tab=raw&q=zzzz-no-match"), /ไม่พบล็อตวัตถุดิบ/);
  assert.match(warehouse("p=warehouse&tab=fg", { fgBoxes: [] }), /ยังไม่มีกล่องสินค้า/);
  assert.match(warehouse("p=warehouse&tab=fg&q=zzzz-no-match"), /ไม่พบกล่องสินค้า/);
});
