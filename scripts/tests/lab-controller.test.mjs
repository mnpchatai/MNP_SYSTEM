import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup(respond) {
  const elements = new Map();
  const events = {};
  const documentEvents = {};
  const calls = [];
  let authChange;
  let denied = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#lab-sort" ? "recent" : "", textContent: "", innerHTML: "", hidden: false, clientWidth: 600, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {}, classList: { toggle() {} },
      querySelector: (inner) => element(inner), querySelectorAll: () => [], contains: (target) => target === elements.get(selector),
    });
    return elements.get(selector);
  };
  const ticks = [];
  const window = { addEventListener: (name, fn) => { events[name] = fn; }, setInterval: (fn) => { ticks.push(fn); return ticks.length; }, clearInterval() {}, clearTimeout() {}, cancelAnimationFrame() {} };
  const context = vm.createContext({ window, console, URLSearchParams, Map, Set, Date, Intl, location: { hash: "#/lab" }, history: { replaceState() {} },
    friendlyError: (error) => String(error?.message ?? error),
    document: { hidden: false, addEventListener(name, fn) { (documentEvents[name] ??= []).push(fn); }, removeEventListener(name, fn) { documentEvents[name] = (documentEvents[name] ?? []).filter((item) => item !== fn); }, querySelector: element, querySelectorAll: () => [] },
    state: { employee: { id: "admin", labAccess: true } }, app: { innerHTML: "" },
    sb: { auth: { onAuthStateChange: (fn) => { authChange = fn; } }, rpc: async (name, args) => {
      calls.push({ name, args }); return respond(name, args);
    } },
    shell: (html) => html, bindShell() {}, loadingShell() {}, renderNotFound() { denied += 1; }, zoomIntoContent() {},
  });
  for (const file of ["lab-range.js", "lab-mooney-model.js", "lab-mooney-chart.js", "lab-sections.js", "lab-mooney-views.js", "lab-mdr-model.js", "lab-mdr-views.js", "lab-mdr-page.js", "module-lab.js"]) {
    vm.runInContext(readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8"), context);
  }
  return { context, calls, element, events, documentEvents, auth: (event) => authChange(event), denied: () => denied, tick: () => ticks.at(-1)(),
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
  assert.match(app.element("#lab-updated").textContent, /1 ม.ค. 2569/);
  assert.match(app.element("#lab-status").textContent, /ยังไม่อัปเดต/);
});

test("the dashboard reads the same compact overview RPC the Mooney list uses", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 12000, lastTested: "2026-10-01" }, { material: "B", resultCount: 5, lastTested: "2026-10-03" }]), error: null }));
  await app.open("module=dashboard");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ name: "app_lab_mooney_feed", args: { p_material: null } }]);
  assert.match(app.context.app.innerHTML, /<h1>แดชบอร์ด<\/h1>/);
  assert.match(app.element("#lab-dash-mooney").innerHTML, /12,005/);
  assert.match(app.element("#lab-dash-mooney").innerHTML, /3 ต.ค. 2569/);
  // แดชบอร์ดกับรายการวัสดุใช้แคชชุดเดียวกัน: เปิดรายการทันที แล้วตรวจสิทธิ์/ข้อมูลใหม่เบื้องหลังหนึ่งครั้ง
  await app.open("module=mooney");
  assert.match(app.element("#lab-materials").innerHTML, /A/);
  assert.equal(app.calls.length, 2);
});

test("modules without a data source open without any RPC; unknown modules look like a missing page", async () => {
  const app = setup(() => { throw new Error("must not query"); });
  for (const key of ["chemical"]) {
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
  await denied.open("module=chemical");
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
  assert.match(tiles.innerHTML, /2 ต.ค. 2569/);
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
  assert.match(page, /href="#\/lab\?module=mdr"/);
  assert.doesNotMatch(page, /href="#\/lab\?module=chemical"/);
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

test("with health summaries the dashboard shows the latest day, the trends, the heatmaps and the drill-down of the formula to look at first until the user picks one", async () => {
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
  assert.match(root.innerHTML, /id="lab-trends"/, "the health layout replaces the number tiles");
  assert.doesNotMatch(root.innerHTML, /lab-mill-query|lab-activity|lab-zones/);
  const strip = app.element("#lab-today").innerHTML;
  assert.match(strip, /^<h3 class="lab-dash-card-title" id="lab-today-title">ทดสอบล่าสุด/);
  assert.match(strip, /<button type="button" class="lab-tile is-warn" data-material="A2004"/, "A2004's mills disagree by 6.6 MU on the latest day");
  assert.match(strip, /<button type="button" class="lab-tile is-ok" data-material="B0005"/);
  assert.match(app.element("#lab-trends").innerHTML, new RegExp(`>${model.formatShortDate(model.shiftDate(today, -29))}</text>`), "the trend axis starts 30 days back by default");
  assert.match(app.element("#lab-trends").innerHTML, /^<button type="button" class="lab-trend" data-material="A2004"/, "the formula to look at first comes first");
  assert.match(app.element("#lab-bias").innerHTML, /^<table class="lab-hm">/);
  assert.match(app.element("#lab-uniform").innerHTML, /^<table class="lab-hm">/);
  assert.match(app.element("#lab-control-plot").innerHTML, /^<svg class="lab-cc lab-cc-mv"[^>]*aria-label="A2004 MV/);
  assert.equal(app.element("#lab-control-name").textContent, "A2004");
  assert.equal(app.element("#lab-control-link").href, "#/lab?module=mooney&material=A2004");
  assert.match(app.element("#lab-control-note").textContent, /^CL 40\.\d\d · σ /);
  assert.match(app.element("#lab-drill").innerHTML, /class="lab-flag is-out"[^>]*>ห่างค่ากลางเกิน ±5 \(\+6\.\d\d\)</, "mill 2 alone is more than 5 MU from the centre");
  root.listeners.click({ target: { closest: (selector) => (selector === "[data-measure]" ? { dataset: { measure: "mh" } } : null) } });
  assert.match(app.element("#lab-control-plot").innerHTML, /^<svg class="lab-cc lab-cc-mh"/);
  root.listeners.click({ target: { closest: (selector) => (selector === "[data-material]" ? { dataset: { material: "B0005" } } : null) } });
  assert.match(app.element("#lab-control-plot").innerHTML, /aria-label="B0005 MH/);
  assert.match(app.element("#lab-drill").innerHTML, /class="lab-flag is-ok">ปกติ</);
  root.listeners.click({ target: { closest: (selector) => (selector === "[data-days]" ? { dataset: { days: "14" } } : null) } });
  assert.match(app.element("#lab-trends").innerHTML, new RegExp(`>${model.formatShortDate(model.shiftDate(today, -13))}</text>`), "the trend axis follows the chosen range");
  assert.match(app.element("#lab-control-plot").innerHTML, /aria-label="B0005 MH/, "the user's pick survives a range change");
  // รีเฟรชแล้วข้อมูลเดิม: คงสูตรที่ผู้ใช้เลือกและค่า MH ไว้
  await app.tick();
  await flush();
  assert.match(app.element("#lab-control-plot").innerHTML, /aria-label="B0005 MH/);
});

test("the MDR module reads its own feed per test set, opens the formula page, and drops access when revoked", async () => {
  const feed = { formulas: [{ formula: "A2004", tests: 2, days: 1, first_date: "2026-11-02", last_date: "2026-11-02" }], tests: [], curve_date: null, curves: [] };
  let response = { data: feed, error: null };
  const app = setup(async () => response);
  await app.open("module=mdr");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ name: "app_lab_mdr_feed", args: { p_part: "F1", p_formula: null, p_date: null } }]);
  assert.match(app.context.app.innerHTML, /<h1>รายงานทดสอบ MDR<\/h1>/);
  assert.match(app.context.app.innerHTML, /อัปโหลดไฟล์ MDR \(\.ini\)/);
  assert.match(app.element("#mdr-body").innerHTML, /href="#\/lab\?module=mdr&amp;part=F1&amp;formula=A2004"/);
  response = { data: { ...feed, tests: [
    { id: 1, machine_id: "111", test_date: "2026-11-02", test_time: "15:49", temperature_c: 155, ml: 2.18, mh: 8.69, ts2_s: 39, t90_s: 177 },
    { id: 2, machine_id: "112", test_date: "2026-11-02", test_time: "16:21", temperature_c: 155, ml: 2.18, mh: 8.57, ts2_s: 39, t90_s: 166 },
  ] }, error: null };
  await app.open("module=mdr&part=F2&formula=A2004&date=2026-11-02");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.at(-1).args)), { p_part: "F2", p_formula: "A2004", p_date: "2026-11-02" });
  assert.match(app.element("#mdr-body").innerHTML, /AVG/);
  response = { data: null, error: { message: "NOT_AUTHORIZED" } };
  await app.open("module=mdr");
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
});

test("MDR daily trend: the range bar pans, zooms and picks months, and the table follows; a new formula starts at the latest days", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, machine_id: "111", test_date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), test_time: "08:00", temperature_c: 155, ml: 1, mh: 2 + i, ts2_s: 30, t90_s: 100 + i }));
  const feed = { formulas: [{ formula: "A2004", tests: 40, days: 40, last_date: "2026-11-09" }], tests: rows, curve_date: null, curves: [] };
  const app = setup(async () => ({ data: feed, error: null }));
  await app.open("module=mdr&part=F2&formula=A2004");
  const table = app.element("#mdr-table-scroll");
  const bar = app.element("#mdr-zoom");
  const dayRows = (html = table.innerHTML) => (html.match(/class="lab-mdr-day-row/g) ?? []).length;
  assert.equal(dayRows(app.element("#mdr-body").innerHTML), 30, "the latest 30 test days by default");
  assert.equal(bar.hidden, false);
  assert.equal(app.element("#mdr-month-from").value, "2026-10");
  assert.equal(app.element("#mdr-month-to").value, "2026-11");
  assert.match(app.element("#mdr-trend").innerHTML, /<svg/);
  const press = (dataset) => bar.listeners.click({ target: { closest: () => ({ dataset, disabled: false }) } });
  press({ step: "in" });
  assert.equal(dayRows(), 15, "zoom in halves the days, keeping the newest");
  assert.match(table.innerHTML, /9 พ.ย. 2569/);
  assert.match(app.element("#mdr-range-announce").textContent, /^แสดง 26 ต.ค. 2569 ถึง 9 พ.ย. 2569 15 จาก 40 วันที่ทดสอบ$/);
  press({ step: "back" });
  assert.doesNotMatch(table.innerHTML, /9 พ.ย. 2569/, "pan back leaves the newest days");
  press({ range: "all" });
  assert.equal(dayRows(), 40);
  app.element("#mdr-month-from").value = "2026-11";
  app.element("#mdr-month-to").value = "2026-10";
  bar.listeners.change({ target: app.element("#mdr-month-from") });
  assert.equal(dayRows(), 9, "a start month after the end month moves the end along: November only");
  await app.open("module=mdr&part=F2&formula=B0005");
  assert.equal(dayRows(app.element("#mdr-body").innerHTML), 30, "another formula starts at the latest days again");
});

test("MDR torque chart: its own range bar (latest day by default), several days coloured by day from the curves RPC, the table's button and ?date= mean one day", async () => {
  const dates = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const rows = dates.flatMap((date, d) => [0, 1].map((k) => ({ id: d * 2 + k + 1, machine_id: String(111 + k), test_date: date, test_time: `0${8 + k}:00`, temperature_c: 155, ml: 1, mh: 8, ts2_s: 30, t90_s: 160 + d * 10 + k * 2 })));
  const curve = Array.from({ length: 1801 }, (_, second) => Math.min(8, 1 + second * 0.02));
  const short = curve.filter((_, index) => index % 5 === 0);
  const feed = (date) => ({ formulas: [{ formula: "A2004", tests: 6, days: 3, last_date: "2026-11-03" }], tests: rows, curve_date: date,
    curves: rows.filter((row) => row.test_date === date).map((row) => ({ id: row.id, curve })) });
  let curvesError = null;
  const app = setup(async (name, args) => {
    if (name === "app_lab_mdr_feed") return { data: feed(args.p_date || "2026-11-03"), error: null };
    if (curvesError) return { data: null, error: curvesError };
    const inRange = rows.filter((row) => row.test_date >= args.p_from && row.test_date <= args.p_to);
    const one = args.p_from === args.p_to;
    return { data: { step: one ? 1 : 5, from: inRange[0]?.test_date ?? null, to: inRange.at(-1)?.test_date ?? null, truncated: false,
      curves: inRange.map((row) => ({ id: row.id, test_date: row.test_date, curve: one ? curve : short })) }, error: null };
  });
  const urls = [];
  app.context.history.replaceState = (_state, _title, url) => { urls.push(url); };
  const curveCalls = () => app.calls.filter((call) => call.name === "app_lab_mdr_curves").map((call) => JSON.parse(JSON.stringify(call.args)));

  await app.open("module=mdr&part=F1&formula=A2004");
  const bar = app.element("#mdr-curve-zoom");
  const legend = app.element("#mdr-legend");
  const table = app.element("#mdr-table-scroll");
  const press = (dataset) => bar.listeners.click({ target: { closest: () => ({ dataset, disabled: false }) } });
  assert.equal(bar.hidden, false, "the torque chart has its own bar");
  assert.equal(curveCalls().length, 0, "today's view uses the curves the feed already sent");
  assert.equal((legend.innerHTML.match(/data-test=/g) ?? []).length, 2, "one day: a key per test");
  assert.match(app.element("#mdr-curve-when").textContent, /3 พ.ย. 2569/);
  assert.match(app.element("#mdr-plot").innerHTML, /<svg/);
  assert.equal((app.element("#mdr-body").innerHTML.match(/lab-mdr-day-flag/g) ?? []).length, 1, "only the charted day is marked in the table");

  press({ step: "out" });
  await flush();
  assert.deepEqual(curveCalls(), [{ p_part: "F1", p_formula: "A2004", p_from: "2026-11-02", p_to: "2026-11-03" }], "− widens to two days keeping the newest");
  assert.equal((legend.innerHTML.match(/data-day=/g) ?? []).length, 2, "several days: a key per day");
  assert.match(legend.innerHTML, /3 พ.ย. 2569<\/span><small>2 ครั้ง<\/small>/);
  assert.equal(app.element("#mdr-curve-when").textContent, "", "the dates are on the day keys, not repeated in the heading");
  assert.match(app.element("#mdr-plot").innerHTML, /data-day="2026-11-02"/);
  assert.equal((table.innerHTML.match(/lab-mdr-day-flag/g) ?? []).length, 2, "the table marks both charted days");
  assert.equal(urls.at(-1), "#/lab?module=mdr&part=F1&formula=A2004", "several days are not put in the link");
  assert.match(app.element("#mdr-curve-announce").textContent, /^แสดง 2 พ.ย. 2569 ถึง 3 พ.ย. 2569 2 จาก 3 วันที่ทดสอบ$/);

  press({ step: "in" });
  await flush();
  assert.equal(curveCalls().length, 1, "+ back to the newest day: no new read");
  assert.equal((legend.innerHTML.match(/data-test=/g) ?? []).length, 2);

  press({ step: "back" });
  await flush();
  assert.deepEqual(curveCalls().at(-1), { p_part: "F1", p_formula: "A2004", p_from: "2026-11-02", p_to: "2026-11-02" }, "‹ steps one day back at width 1");
  assert.equal(urls.at(-1), "#/lab?module=mdr&part=F1&formula=A2004&date=2026-11-02", "one past day goes into the link");

  table.listeners.click({ target: { closest: (selector) => (selector === "[data-show-date]" ? { dataset: { showDate: "2026-11-01" } } : null) } });
  await flush();
  assert.deepEqual(curveCalls().at(-1), { p_part: "F1", p_formula: "A2004", p_from: "2026-11-01", p_to: "2026-11-01" }, "the table's ดูกราฟ = that one day");
  assert.match(app.element("#mdr-curve-when").textContent, /1 พ.ย. 2569/);

  press({ range: "all" });
  await flush();
  assert.deepEqual(curveCalls().at(-1), { p_part: "F1", p_formula: "A2004", p_from: "2026-11-01", p_to: "2026-11-03" });
  assert.equal((legend.innerHTML.match(/data-day=/g) ?? []).length, 3);

  curvesError = { message: "LAB_MDR_INVALID_RANGE" };
  table.listeners.click({ target: { closest: (selector) => (selector === "[data-show-date]" ? { dataset: { showDate: "2026-11-01" } } : null) } });
  press({ step: "out" }); // 1–2 พ.ย. ยังไม่เคยอ่าน
  await flush();
  assert.match(app.element("#mdr-curve-note").textContent, /^อ่านกราฟแรงบิดไม่สำเร็จ/, "a failed read says so under the chart");
  assert.equal(legend.innerHTML, "");
  curvesError = { message: "NOT_AUTHORIZED" };
  press({ step: "back" });
  await flush();
  assert.equal(app.denied(), 1, "losing LAB access while reading curves drops the page");

  // ลิงก์ที่มี date= เปิดกราฟวันนั้นวันเดียว (กราฟจาก feed ไม่ต้องอ่านซ้ำ)
  const linked = setup(async (name, args) => ({ data: feed(args.p_date || "2026-11-03"), error: null }));
  await linked.open("module=mdr&part=F1&formula=A2004&date=2026-11-02");
  assert.equal(linked.calls.filter((call) => call.name === "app_lab_mdr_curves").length, 0);
  assert.match(linked.element("#mdr-curve-when").textContent, /2 พ.ย. 2569/);
  assert.match(linked.element("#mdr-body").innerHTML, /data-show-date="2026-11-03"/, "the newest day offers its chart: the link's day is charted");
});

test("MDR month pick (A): October with two test days shows those two days, the boxes keep October, and ‹ › keep the width", async () => {
  const dates = ["2026-10-27", "2026-10-28", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
  const rows = dates.map((date, i) => ({ id: i + 1, machine_id: "111", test_date: date, test_time: "08:00", set_minutes: 30, temperature_c: 155, ml: 1, mh: 6 + i * 0.1, t90_s: 150 }));
  const app = setup(async () => ({ data: { formulas: [{ formula: "A2004", tests: 6, days: 6, last_date: "2026-11-05" }], tests: rows, curve_date: null, curves: [] }, error: null }));
  await app.open("module=mdr&part=F2&formula=A2004");
  const bar = app.element("#mdr-zoom");
  const table = app.element("#mdr-table-scroll");
  app.element("#mdr-month-from").value = "2026-10";
  app.element("#mdr-month-to").value = "2026-10";
  bar.listeners.change({ target: app.element("#mdr-month-to") });
  assert.equal((table.innerHTML.match(/class="lab-mdr-day-row/g) ?? []).length, 2);
  assert.doesNotMatch(table.innerHTML, /2 พ.ย./, "no November day added");
  assert.equal(app.element("#mdr-month-to").value, "2026-10", "the end box keeps October");
  bar.listeners.click({ target: { closest: () => ({ dataset: { step: "forward" }, disabled: false }) } });
  assert.equal((table.innerHTML.match(/class="lab-mdr-day-row/g) ?? []).length, 2, "panning a two-day pick moves two days, it does not widen to three");
  // เดือนล่าสุดที่มี 2 วัน: ‹ แล้ว › กลับมาถึงวันล่าสุด ยังกว้าง 2 วัน
  const latestTwo = setup(async () => ({ data: { formulas: [{ formula: "A2004" }], tests: [...rows.slice(0, 4).map((row, i) => ({ ...row, test_date: `2026-10-2${4 + i}` })), ...rows.slice(4)], curve_date: null, curves: [] }, error: null }));
  await latestTwo.open("module=mdr&part=F2&formula=A2004");
  const bar2 = latestTwo.element("#mdr-zoom");
  latestTwo.element("#mdr-month-from").value = "2026-11";
  latestTwo.element("#mdr-month-to").value = "2026-11";
  bar2.listeners.change({ target: latestTwo.element("#mdr-month-to") });
  const step = (key) => bar2.listeners.click({ target: { closest: () => ({ dataset: { step: key }, disabled: false }) } });
  step("back");
  step("forward");
  assert.equal((latestTwo.element("#mdr-table-scroll").innerHTML.match(/class="lab-mdr-day-row/g) ?? []).length, 2, "back at the newest day: still two days");
});

test("MDR: a chosen day stays when older days arrive (E); a late feed of a formula left behind does not paint over the new one (G)", async () => {
  const row = (id, date) => ({ id, machine_id: "111", test_date: date, test_time: "08:00", set_minutes: 30, temperature_c: 155, ml: 1, mh: 8, ts2_s: 30, t90_s: 160 });
  let rows = [row(1, "2026-11-01"), row(2, "2026-11-02"), row(3, "2026-11-03")];
  const curve = Array.from({ length: 1801 }, (_, second) => Math.min(8, 1 + second * 0.02));
  const gates = new Map();
  const app = setup(async (name, args) => {
    if (gates.has(args.p_formula)) await gates.get(args.p_formula);
    if (name === "app_lab_mdr_curves") {
      const inRange = rows.filter((item) => item.test_date >= args.p_from && item.test_date <= args.p_to);
      return { data: { step: 1, from: args.p_from, to: args.p_to, truncated: false, curves: inRange.map((item) => ({ id: item.id, curve })) }, error: null };
    }
    const date = args.p_date || rows.at(-1).test_date;
    return { data: { formulas: [{ formula: "A2004" }, { formula: "B0005" }, { formula: "C1" }], tests: rows, curve_date: date,
      curves: rows.filter((item) => item.test_date === date).map((item) => ({ id: item.id, curve })) }, error: null };
  });
  await app.open("module=mdr&part=F1&formula=A2004&date=2026-11-02");
  assert.match(app.element("#mdr-curve-when").textContent, /2 พ.ย. 2569/);
  rows = [row(8, "2026-10-29"), row(9, "2026-10-30"), ...rows];
  app.element("#mdr-formula").listeners.change({ target: { value: "A2004" } }); // วาดสูตรเดิมใหม่ (เหมือนหลังอัปโหลด)
  await flush();
  await flush();
  assert.match(app.element("#mdr-curve-when").textContent, /2 พ.ย. 2569/, "still 2 Nov after two older days arrived (was 31 Oct before the fix)");

  let release;
  gates.set("B0005", new Promise((resolve) => { release = resolve; }));
  app.element("#mdr-formula").listeners.change({ target: { value: "B0005" } });
  app.element("#mdr-formula").listeners.change({ target: { value: "C1" } });
  await flush();
  await flush();
  assert.match(app.element("#mdr-body").innerHTML, /<option value="C1" selected>/);
  release();
  await flush();
  await flush();
  assert.match(app.element("#mdr-body").innerHTML, /<option value="C1" selected>/, "B0005 answered last but C1 stays on screen");
});

test("MDR torque chart: the table marks only the days actually drawn when the 1,000-curve cap trims old days (F)", async () => {
  const dates = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const rows = dates.map((date, i) => ({ id: i + 1, machine_id: "111", test_date: date, test_time: "08:00", set_minutes: 30, temperature_c: 155, ml: 1, mh: 8, ts2_s: 30, t90_s: 160 }));
  const curve = Array.from({ length: 361 }, (_, i) => Math.min(8, 1 + i * 0.1));
  const app = setup(async (name) => (name === "app_lab_mdr_feed"
    ? { data: { formulas: [{ formula: "A2004" }], tests: rows, curve_date: "2026-11-03", curves: [{ id: 3, curve }] }, error: null }
    : { data: { step: 5, from: "2026-11-02", to: "2026-11-03", truncated: true, curves: [{ id: 2, curve }, { id: 3, curve }] }, error: null }));
  await app.open("module=mdr&part=F1&formula=A2004");
  app.element("#mdr-curve-zoom").listeners.click({ target: { closest: () => ({ dataset: { range: "all" }, disabled: false }) } });
  await flush();
  const table = app.element("#mdr-table-scroll").innerHTML;
  assert.equal((table.match(/lab-mdr-day-flag/g) ?? []).length, 2, "1 Nov was cut by the cap: no tag");
  assert.match(table, /data-show-date="2026-11-01"/, "the cut day offers its own chart instead");
  assert.match(app.element("#mdr-curve-note").textContent, /^กราฟแสดงได้ไม่เกิน 1,000 ครั้ง/);
});

test("MDR torque chart: going back to the drawn range while another range is still loading cancels that read", async () => {
  const dates = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const rows = dates.flatMap((date, d) => [0, 1].map((k) => ({ id: d * 2 + k + 1, machine_id: String(111 + k), test_date: date, test_time: `0${8 + k}:00`, temperature_c: 155, ml: 1, mh: 8, ts2_s: 30, t90_s: 160 })));
  const curve = Array.from({ length: 1801 }, (_, second) => Math.min(8, 1 + second * 0.02));
  const feed = { formulas: [{ formula: "A2004", tests: 6, days: 3, last_date: "2026-11-03" }], tests: rows, curve_date: "2026-11-03",
    curves: rows.filter((row) => row.test_date === "2026-11-03").map((row) => ({ id: row.id, curve })) };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const app = setup(async (name, args) => {
    if (name === "app_lab_mdr_feed") return { data: feed, error: null };
    await gate;
    const inRange = rows.filter((row) => row.test_date >= args.p_from && row.test_date <= args.p_to);
    return { data: { step: 5, from: args.p_from, to: args.p_to, truncated: false, curves: inRange.map((row) => ({ id: row.id, curve: curve.filter((_, i) => i % 5 === 0) })) }, error: null };
  });
  await app.open("module=mdr&part=F1&formula=A2004");
  const bar = app.element("#mdr-curve-zoom");
  const legend = app.element("#mdr-legend");
  const press = (dataset) => bar.listeners.click({ target: { closest: () => ({ dataset, disabled: false }) } });
  press({ step: "out" });
  await flush();
  assert.equal(app.element("#mdr-curve-note").textContent, "กำลังโหลดกราฟ…");
  press({ step: "in" });
  await flush();
  assert.equal(app.element("#mdr-curve-note").textContent, "", "back on the drawn day: no loading message left behind");
  release();
  await flush();
  await flush();
  assert.equal((legend.innerHTML.match(/data-day=/g) ?? []).length, 0, "the late two-day answer does not draw over the one-day chart");
  assert.equal((legend.innerHTML.match(/data-test=/g) ?? []).length, 2);
  assert.match(app.element("#mdr-curve-when").textContent, /3 พ.ย. 2569/);
});

test("MDR torque chart: a tap anywhere outside the chart hides the t90 tooltip (iPhone does not always blur), and the listener leaves with the page", async () => {
  const rows = [{ id: 1, machine_id: "111", test_date: "2026-11-03", test_time: "08:00", set_minutes: 30, temperature_c: 155, ml: 1, mh: 8, t90_s: 160 }];
  const curve = Array.from({ length: 1801 }, (_, second) => Math.min(8, 1 + second * 0.02));
  const app = setup(async () => ({ data: { formulas: [{ formula: "A2004" }], tests: rows, curve_date: "2026-11-03", curves: [{ id: 1, curve }] }, error: null }));
  await app.open("module=mdr&part=F1&formula=A2004");
  const tip = app.element("#mdr-tip");
  const plot = app.element("#mdr-plot");
  const taps = () => app.documentEvents.pointerdown ?? [];
  assert.equal(taps().length, 1, "one document listener per chart");
  tip.hidden = false;
  taps().forEach((fn) => fn({ target: plot }));
  assert.equal(tip.hidden, false, "a tap on the chart itself keeps the tooltip");
  taps().forEach((fn) => fn({ target: app.element("#mdr-table-scroll") }));
  assert.equal(tip.hidden, true, "a tap elsewhere hides it");
  await app.open("module=mdr&part=F2"); // หน้าอื่น (รายการสูตร ไม่มีกราฟ) แทนที่หน้านี้
  [...taps()].forEach((fn) => fn({ target: app.element("#mdr-table-scroll") }));
  assert.equal(taps().length, 0, "after leaving the page the listener removes itself");
});
