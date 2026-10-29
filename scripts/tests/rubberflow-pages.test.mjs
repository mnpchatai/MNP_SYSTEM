import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดโมดูล RubberFlow ทั้งชุด (modules/rubberflow-*.js + module-rubberflow.js, script ธรรมดาใน browser) เข้า context จำลองที่มี helper ของ app.js
// แบบ stub และ localStorage จำลอง แล้ววาดทุกหน้า × ทุกบทบาท เรียก dialog ทุกตัว และยิงฟอร์ม/ปุ่มผ่านกติกา data-rf-* ของไฟล์หลัก
const FILES = [
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
  const log = { toasts: [], renders: 0, notFound: 0, hash: `#/rubberflow${route ? `?${route}` : ""}`, dialogs: [] };
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
    renderRoute: async () => { log.renders += 1; }, confirm: () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, requestAnimationFrame: () => 0,
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
  assert.match(html, /<h1>เลือกบทบาทสาธิต<\/h1>/, "the chooser is the page's single h1");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.equal((html.match(/data-rf-user-pick=/g) ?? []).length, 9);
  assert.doesNotMatch(html, /rf-toolbar/, "no toolbar before a persona is chosen");
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

test("the dashboard, stations and quality pages show the prototype's facts from the seed", async () => {
  const env = load();
  env.store.setUser("U01");
  const dashboard = text(await env.render());
  assert.match(dashboard, /Yield รวม 4 ขั้นตอน/);
  assert.match(dashboard, /ใบสั่งผลิตที่เปิดอยู่ 3/, "released + in_progress orders");
  assert.match(dashboard, /STAGE 1 ผสมยาง[\s\S]*STAGE 4 ตกแต่งและบรรจุ/);
  assert.match(await env.render(), /rf-chart-area[\s\S]*rf-chart-bar/, "both SVG charts are drawn");
  const mixing = await env.render("p=mixing");
  assert.match(mixing, /สถานีที่ 1 · ผสมยาง/);
  assert.match(mixing, /บ่มอีก/, "the batch mixed 1.5 hours ago shows its rest timer");
  assert.match(mixing, /data-rf-action="endRest"/, "admin may skip the rest in demo mode");
  const gated = await env.render("p=extrusion");
  assert.match(gated, /กักกัน \(Hold\)/);
  assert.match(gated, /Gatekeeper/, "nothing received at extrusion yet");
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
  assert.match(finishing, /Gatekeeper/, "nothing received at finishing yet");
  assert.doesNotMatch(finishing, /data-rf-form="recordFinishing"/);
  const quality = text(await env.render("p=quality"));
  assert.match(quality, /ล็อตรอตัดสิน \(Hold\) 1/);
  assert.match(quality, /NCR \/ CAPA \(2\)/);
  const ncr = await env.render("p=quality&tab=ncr");
  assert.match(ncr, /วิเคราะห์ 5-Why/);
  assert.match(ncr, /data-rf-form="closeNcr"/, "the open NCR has a close form for QC");
  const spc = await env.render("p=spc&ch=cu.temp");
  assert.match(spc, /I-chart · อบ · อุณหภูมิอบ/);
  assert.match(spc, /rf-spc-chart/);
  assert.match(spc, /<option value="cu.temp" selected>/);
  const trace = await env.render(`p=trace&q=${env.store.data().fgBoxes[0].id}`);
  assert.match(trace, /ย้อนกลับไปต้นทาง/);
  assert.match(trace, /rf-node is-hit/);
  const wip = text(await env.render("p=wip"));
  assert.match(wip, /รอรับมอบ \(1\)/);
  const warehouse = await env.render("p=warehouse&tab=fg");
  assert.match(warehouse, /data-rf-form="shipBoxes"/);
  assert.match(warehouse, /name="ids\[\]"/);
  const requisition = await env.render("p=requisition");
  assert.match(requisition, /สถานีชั่ง · รายการ 3\/\d+/, "the open requisition has two lines weighed");
  assert.match(requisition, /data-rf-form="weighLine"/);
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
    ["createRequisition", {}, /data-rf-form="createRequisition"/], ["transfer", { lotId: sendable.id }, /data-rf-form="createTransfer"/], ["receive", { id: inTransit.id }, /data-rf-form="receiveTransfer"/],
    ["qcRecord", { lotId: data.lots[0].id }, /data-rf-form="addQcRecord"[\s\S]*name="values\.hardness"/], ["ncr", {}, /data-rf-form="createNcr"[\s\S]*name="whys\[\]"/],
    ["scan", { code: data.fgBoxes[0].id }, /กล่องสินค้าสำเร็จรูป/], ["alerts", {}, /การแจ้งเตือน \(\d+\)/],
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
  const button = { ...env.root, dataset: { rfAction: "cleanMold", rfArgs: JSON.stringify({ id: "DIE-DS-01" }), rfConfirm: "ยืนยัน?" }, handlers: {} };
  button.addEventListener = (type, handler) => { button.handlers[type] = handler; };
  env.fakes["[data-rf-action]"] = [button];
  delete env.fakes["form[data-rf-form]"];
  await env.render("p=molds");
  button.handlers.click();
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
  reset.handlers.click();
  assert.ok(env.store.data().molds[0].usageSinceClean > 0);
  assert.deepEqual(env.log.toasts.at(-1), ["รีเซ็ตข้อมูลสาธิตเรียบร้อย", "ok"]);
});

test("pages carry their module hue, and the side menu, page head and callouts use the emoji icon set", async () => {
  const env = load();
  env.store.setUser("U01");
  const html = await env.render("p=mixing");
  assert.match(html, /<div class="rf-page" data-rf-mod="mixing">/);
  assert.match(html, /<header class="rf-pagehead"><div class="rf-pagehead-main"><span class="rf-mod-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">🌀<\/span><\/span><div><h1>/, "the page head shows the module emoji before its single h1");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-rf-design/, "no design switcher any more");
  const sub = env.module.nav[0].subnav("rubberflow");
  assert.match(sub, /class="rf-nav-item" data-rf-mod="orders" [^>]*><span class="rf-nav-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">📋<\/span><\/span><span class="rf-nav-text">ใบสั่งผลิต<\/span>/);
  const gated = await env.render("p=extrusion");
  assert.match(gated, /<div class="rf-callout is-warn" role="note"><span class="rf-callout-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">⚠️<\/span><\/span><div class="rf-callout-body"><strong>Gatekeeper:/);
  assert.match(await env.render(), /<div class="rf-page" data-rf-mod="dashboard">/);
  env.store.setUser(null);
});
