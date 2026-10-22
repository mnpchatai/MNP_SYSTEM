import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup(respond) {
  const elements = new Map();
  const events = {};
  const calls = [];
  let authChange;
  let denied = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#lab-sort" ? "recent" : "", textContent: "", innerHTML: "", hidden: false, clientWidth: 600, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, classList: { toggle() {} },
      querySelector: (inner) => element(inner), querySelectorAll: () => [],
    });
    return elements.get(selector);
  };
  const ticks = [];
  const window = { addEventListener: (name, fn) => { events[name] = fn; }, setInterval: (fn) => { ticks.push(fn); return ticks.length; }, clearInterval() {}, clearTimeout() {}, cancelAnimationFrame() {} };
  const context = vm.createContext({ window, console, URLSearchParams, Map, Set, Date, Intl, location: { hash: "#/lab" },
    document: { hidden: false, addEventListener() {}, querySelector: element, querySelectorAll: () => [] },
    state: { employee: { id: "admin", labAccess: true } }, app: { innerHTML: "" },
    sb: { auth: { onAuthStateChange: (fn) => { authChange = fn; } }, rpc: async (name, args) => {
      calls.push({ name, args }); return respond(name, args);
    } },
    shell: (html) => html, bindShell() {}, loadingShell() {}, renderNotFound() { denied += 1; }, zoomIntoContent() {},
  });
  for (const file of ["lab-mooney-model.js", "lab-mooney-chart.js", "lab-sections.js", "lab-mooney-views.js", "module-lab.js"]) {
    vm.runInContext(readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8"), context);
  }
  return { context, calls, element, events, auth: (event) => authChange(event), denied: () => denied, tick: () => ticks.at(-1)(),
    open: (params = "") => window.MNP_REQUEST_MODULES.MNP_LAB.pages.lab(new URLSearchParams(params)) };
}
const body = (materials = []) => ({ generated_at: new Date().toISOString(), materials, rows: [] });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("overview uses one scoped RPC and paints precomputed summaries without raw rows", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 12000, lastTested: "2026-10-01" }]), error: null }));
  await app.open("module=mooney");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ name: "app_lab_mooney_feed", args: { p_material: null } }]);
  assert.match(app.element("#lab-materials").innerHTML, /A/);
  assert.match(app.element("#lab-materials").innerHTML, /12,000/);
  assert.match(app.element("#lab-updated").textContent, /ข้อมูลชีต/);
});

test("cached navigation paints before slow revalidation, then removes access when revoked", async () => {
  let resolve;
  let count = 0;
  const app = setup(async () => ++count === 1 ? { data: body([{ material: "A", resultCount: 1 }]), error: null }
    : await new Promise((done) => { resolve = done; }));
  await app.open("module=mooney");
  app.context.app.innerHTML = "reset";
  await app.open("module=mooney");
  assert.notEqual(app.context.app.innerHTML, "reset", "cached screen paints without waiting for RPC");
  assert.equal(app.calls.length, 2, "server permissions still rechecked");
  resolve({ error: { message: "NOT_AUTHORIZED" } });
  await flush();
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
});

test("sign out clears caches and an old in-flight page cannot repaint another account", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const pending = app.open("module=mooney");
  app.auth("SIGNED_OUT");
  app.context.state.employee = { id: "other", labAccess: false };
  app.context.app.innerHTML = "other account";
  resolve({ data: body(), error: null });
  await pending;
  assert.equal(app.context.app.innerHTML, "other account");
  assert.equal(app.denied(), 0, "old response cannot revoke the new account");
});

test("leaving LAB cancels stale initial renders; no permission means no RPC", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const pending = app.open("module=mooney");
  app.context.location.hash = "#/requests";
  app.events.hashchange();
  app.context.app.innerHTML = "requests";
  resolve({ data: body(), error: null });
  await pending;
  assert.equal(app.context.app.innerHTML, "requests");
  const denied = setup(() => { throw new Error("must not query"); });
  denied.context.state.employee.labAccess = false;
  await denied.open("module=mooney");
  assert.equal(denied.calls.length, 0);
});

test("material navigation scopes its RPC and keeps the full material selector on an empty result", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 2 }, { material: "B", resultCount: 3 }]), error: null }));
  await app.open("module=mooney&material=A");
  assert.equal(app.calls[0].args.p_material, "A");
  assert.match(app.element("#lab-material-select").innerHTML, /value="A" selected/);
  assert.match(app.element("#lab-material-select").innerHTML, /value="B"/);
  assert.equal(app.element("#lab-none").hidden, false);
  assert.equal(app.element("#lab-body").hidden, true);
});

test("stale data retains its original date and gives a freshness warning", async () => {
  const data = { ...body(), generated_at: "2026-01-01T01:02:03Z" };
  const app = setup(async () => ({ data, error: null }));
  await app.open("module=dashboard");
  assert.match(app.element("#lab-updated").textContent, /01\/01\/2026/);
  assert.match(app.element("#lab-status").textContent, /ยังไม่อัปเดต/);
});

test("the dashboard reads the same compact overview RPC the Mooney list uses", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 12000, lastTested: "2026-10-01" }, { material: "B", resultCount: 5, lastTested: "2026-10-03" }]), error: null }));
  await app.open("module=dashboard");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ name: "app_lab_mooney_feed", args: { p_material: null } }]);
  assert.match(app.context.app.innerHTML, /<h1>แดชบอร์ด<\/h1>/);
  assert.match(app.element("#lab-dash-mooney").innerHTML, /12,005/);
  assert.match(app.element("#lab-dash-mooney").innerHTML, /03\/10\/2026/);
  // แดชบอร์ดกับรายการวัสดุใช้แคชชุดเดียวกัน: เปิดรายการทันที แล้วตรวจสิทธิ์/ข้อมูลใหม่เบื้องหลังหนึ่งครั้ง
  await app.open("module=mooney");
  assert.match(app.element("#lab-materials").innerHTML, /A/);
  assert.equal(app.calls.length, 2);
});

test("modules without a data source open without any RPC; unknown modules look like a missing page", async () => {
  const app = setup(() => { throw new Error("must not query"); });
  for (const key of ["chemical", "mdr"]) {
    await app.open(`module=${key}`);
    assert.match(app.context.app.innerHTML, /ยังไม่เปิดใช้งาน/);
    assert.match(app.context.app.innerHTML, /lab-module-header is-off/);
  }
  assert.equal(app.calls.length, 0);
  await app.open("module=unknown");
  assert.equal(app.denied(), 1);
  assert.equal(app.calls.length, 0);
  const denied = setup(() => { throw new Error("must not query"); });
  denied.context.state.employee.labAccess = false;
  await denied.open("module=mdr");
  assert.equal(denied.denied(), 1, "no LAB access: even a page without data is not shown");
});

test("links made before the modules were split (#/lab?material=…) still open the Mooney material page", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 2 }]), error: null }));
  await app.open("material=A");
  assert.equal(app.calls[0].args.p_material, "A");
  assert.match(app.element("#lab-material-select").innerHTML, /value="A" selected/);
});

test("dashboard auto-refresh repaints only when the numbers change and removes the page when access is revoked", async () => {
  let response = { data: body([{ material: "A", resultCount: 1, lastTested: "2026-10-01" }]), error: null };
  const app = setup(async () => response);
  await app.open("module=dashboard");
  const tiles = app.element("#lab-dash-mooney");
  tiles.innerHTML = "unchanged";
  app.tick();
  await flush();
  assert.equal(tiles.innerHTML, "unchanged", "same numbers: nothing is redrawn inside the aria-live region");
  response = { data: body([{ material: "A", resultCount: 2, lastTested: "2026-10-02" }]), error: null };
  app.tick();
  await flush();
  assert.match(tiles.innerHTML, /02\/10\/2026/);
  response = { data: null, error: { message: "NOT_AUTHORIZED" } };
  app.tick();
  await flush();
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
  assert.equal(app.calls.length, 4);
});

test("#/lab is the module chooser: no RPC, a card per module, and only modules with a page are links", async () => {
  const app = setup(() => { throw new Error("must not query"); });
  await app.open();
  const page = app.context.app.innerHTML;
  assert.equal(app.calls.length, 0, "the chooser shows no test data, so it reads nothing");
  assert.equal((page.match(/lab-module-card/g) ?? []).length, 4);
  assert.match(page, /href="#\/lab\?module=dashboard"/);
  assert.match(page, /href="#\/lab\?module=mooney"/);
  assert.doesNotMatch(page, /href="#\/lab\?module=(chemical|mdr)"/);
  const denied = setup(() => { throw new Error("must not query"); });
  denied.context.state.employee.labAccess = false;
  await denied.open();
  assert.equal(denied.denied(), 1);
});

test("entering a module from its card zooms the module page in once it is painted; typing the URL does not", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 1, lastTested: "2026-10-01" }]), error: null }));
  let zooms = 0;
  app.context.zoomIntoContent = () => { zooms += 1; };
  const card = { hash: "#/lab?module=dashboard", addEventListener(name, fn) { this[name] = fn; } };
  app.context.document.querySelectorAll = (selector) => (selector === ".lab-module-card[href]" ? [card] : []);
  await app.open();
  card.click({ button: 0 });
  app.context.location.hash = card.hash;
  await app.open("module=dashboard");
  assert.equal(zooms, 1);
  await app.open("module=dashboard");
  assert.equal(zooms, 1, "a refresh or direct link does not replay the zoom");
  await app.open();
  card.click({ button: 0, ctrlKey: true });
  await app.open("module=dashboard");
  assert.equal(zooms, 1, "ctrl-click opens a new tab; no zoom is queued here");
});

test("with health summaries the dashboard is one mill table; the worst row's formula is charted until the user picks one", async () => {
  const model = (await import("node:module")).createRequire(import.meta.url)("../../modules/lab-mooney-model.js");
  const today = model.todayInBangkok();
  const rows = [];
  // วันละสองโม่ โม่ละสองเส้น เส้นละสามส่วน (ID = โม่ เส้น ส่วน) ค่าเฉลี่ยของโม่ตาม mills
  const add = (material, date, mills) => Object.entries(mills).forEach(([mill, mv]) => [1, 2].forEach((strand) => [1, 2, 3].forEach((part) => rows.push({
    source_sheet: material, material, sample_id: `${mill}${strand}${part}`, test_date: date, test_time: `0${mill}:${strand}${part}:00`,
    temperature_c: 100, test_minutes: 4, mv, avg_mv: mv, sd_mv: 0.2, mh: mv + 30, avg_mh: mv + 30, sd_mh: 0.2,
  }))));
  for (let day = 25; day >= 1; day -= 1) {
    add("A2004", model.shiftDate(today, -day), { 1: 40 + Math.sin(day) * 0.4, 2: 40 + Math.cos(day) * 0.4 });
    add("B0005", model.shiftDate(today, -day), { 1: 48 + Math.sin(day) * 0.4, 2: 48 + Math.cos(day) * 0.4 });
  }
  add("A2004", today, { 1: 40.2, 2: 46.8 });
  add("B0005", today, { 1: 48.1, 2: 48.2 });
  const materials = JSON.parse(JSON.stringify(model.buildMaterialSummaries(model.normalizeFeed({ rows }).rows)));
  const app = setup(async () => ({ data: body(materials), error: null }));
  await app.open("module=dashboard");
  const root = app.element("#lab-dash-mooney");
  assert.match(root.innerHTML, /id="lab-mill-rows"/, "the health layout replaces the number tiles");
  assert.doesNotMatch(root.innerHTML, /lab-activity|lab-zones/);
  const table = app.element("#lab-mill-rows").innerHTML;
  assert.match(table, /^<tr class="lab-mill-row" data-material="A2004"[\s\S]*?ห่างค่ากลางเกิน ±5/, "the red mill is the first row");
  assert.equal(app.element("#lab-mill-empty").hidden, true);
  assert.match(app.element("#lab-control-plot").innerHTML, /^<svg class="lab-cc lab-cc-mv"[^>]*aria-label="A2004 MV/);
  assert.equal(app.element("#lab-control-name").textContent, "A2004");
  assert.equal(app.element("#lab-control-link").href, "#/lab?module=mooney&material=A2004");
  root.listeners.click({ target: { closest: (selector) => (selector === "[data-measure]" ? { dataset: { measure: "mh" } } : null) } });
  assert.match(app.element("#lab-control-plot").innerHTML, /^<svg class="lab-cc lab-cc-mh"/);
  root.listeners.click({ target: { closest: (selector) => (selector === ".lab-mill-row" ? { dataset: { material: "B0005" } } : null) } });
  assert.match(app.element("#lab-control-plot").innerHTML, /aria-label="B0005 MH/);
  // ตัวกรอง: เกณฑ์ ±5 ไม่มีโม่ที่ต่างจากวันเกิน แต่โม่ที่ห่างค่ากลางยังแดง
  app.element("#lab-mill-threshold").value = "5";
  root.listeners.change({ target: { id: "lab-mill-threshold" } });
  assert.match(app.element("#lab-mill-rows").innerHTML, /data-material="A2004"/);
  app.element("#lab-mill-query").value = "zzz";
  root.listeners.input({ target: { id: "lab-mill-query" } });
  assert.equal(app.element("#lab-mill-empty").hidden, false);
  assert.equal(app.element("#lab-mill-empty").textContent, "ไม่มีโม่ที่ต้องดูใน 14 วันล่าสุด");
  // รีเฟรชแล้วข้อมูลเดิม: คงสูตรที่ผู้ใช้เลือกและค่า MH ไว้
  await app.tick();
  await flush();
  assert.match(app.element("#lab-control-plot").innerHTML, /aria-label="B0005 MH/);
});
