// ข้อเล็กจาก critique 2026-11-10: เมนูมือถือคลุมแถบตัดสินใจ นับถอยหลังทวนเหตุผล J/K ทุกแถว กรอบโฟกัสชั้นเดียว
// ขอบเขตรายการชุดเดียว ป้าย TEST ที่เดียว และกราฟ RubberFlow ที่ไม่มีข้อมูล
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = read("app.js");
const css = read("styles.css");
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const functionSource = (name) => {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in app.js`);
  return app.slice(start, app.indexOf("\n}", start) + 2);
};
const load = (name, globals = {}) => {
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${functionSource(name)}\nthis.fn = ${name};`, context);
  return context.fn;
};
const zIndexOf = (selector) => {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*z-index: (\\d+)`));
  assert.ok(match, `${selector} has a z-index`);
  return Number(match[1]);
};

test("an open phone menu covers the decision bar, so a decision cannot be tapped through the menu", () => {
  const backdrop = zIndexOf("  .nav-backdrop");
  const bar = zIndexOf("  .action-panel");
  const menu = zIndexOf("  .sidebar");
  assert.ok(bar < backdrop && backdrop < menu, `decision bar ${bar} < backdrop ${backdrop} < menu ${menu}`);
});

test("the undo countdown repeats the typed reason on one line, clipped by character", () => {
  const clip = load("clipText");
  assert.equal(clip("  ไม่ผ่าน\nขอใบเสนอราคาใหม่  ", 80), "ไม่ผ่าน ขอใบเสนอราคาใหม่");
  assert.equal(clip("ก".repeat(81), 80), `${"ก".repeat(79)}…`);
  assert.equal(clip("😀".repeat(5), 4), "😀😀😀…", "never splits a surrogate pair");
  assert.equal(clip(null, 10), "");
  assert.match(app, /setLine\(`กำลังจะ\$\{labelOf\(state\.decision\)\} \$\{request\.request_no\}\$\{state\.comment \? ` · “\$\{clipText\(state\.comment, 80\)\}”` : ""\}`\);/);
});

test("J/K walks every visible queue row: approval rows select, task rows only take focus", () => {
  const handler = app.slice(app.indexOf('if (key === "j" || key === "k") {'), app.indexOf('const panel = document.querySelector("#decision-panel");\n  if (!panel || panel.hidden'));
  assert.match(handler, /document\.querySelectorAll\("#home-queue \.queue-item:not\(\[hidden\]\)"\)/, "task rows included");
  assert.match(handler, /row\.dataset\.requestId \?\? `task:\$\{index\}`/);
  assert.match(handler, /if \(row\.dataset\.requestId && next !== homeQueueState\.selectedId\) selectQueueItem\(next\);/, "only approval rows change the selection");
  assert.match(handler, /document\.activeElement\.closest\("\.queue-item"\)/, "starts from the focused row");
  assert.match(app, /` title="คีย์ลัด: J\/K เลื่อนรายการ · \? ดูทั้งหมด" aria-keyshortcuts="J K \?"`/, "a task-only queue lists J/K without A/R");
});

test("the selected row shows one focus ring, not two", () => {
  assert.match(css, /\.queue-item\.is-selected \.queue-item-main:focus-visible \{ outline: none; \}/);
  assert.match(css, /\.queue-item\.is-selected:has\(\.queue-item-main:focus-visible\) \{ box-shadow: 0 0 0 2px var\(--primary\); \}/);
  assert.match(css, /\.top-actions \.icon-button \{ width: 40px; height: 40px; \}/, "header help/theme buttons are larger on mouse screens");
});

test("a module list has one scope control: mine is a subset of what I may see, the board tracks every request", () => {
  const context = vm.createContext({ window: {}, URLSearchParams });
  context.window = context;
  vm.runInContext(read("modules/request-center.js"), context);
  const tabs = load("requestsViewTabs", { escapeHtml, requestCenterUrl: context.MNP_REQUEST_CENTER.url });
  const parse = (html) => [...html.matchAll(/<a class="view-tab( active)?"(?: aria-current="page")? href="([^"]+)">([^<]+)<\/a>/g)].map((match) => ({ active: Boolean(match[1]), href: match[2].replaceAll("&amp;", "&"), label: match[3] }));
  const base = parse(tabs(new URLSearchParams("type=t-mt&status=pending_assign")));
  assert.deepEqual(base.map((tab) => tab.label), ["ที่ฉันมีสิทธิ์ดู", "ที่ฉันแจ้ง", "ติดตามสถานะทุกใบ"]);
  assert.deepEqual(base.map((tab) => tab.active), [true, false, false]);
  assert.match(base[1].href, /scope=mine/);
  assert.doesNotMatch(base[2].href, /scope=/, "the board ignores the mine-only scope");
  assert.match(base[2].href, /view=board/);
  assert.deepEqual(parse(tabs(new URLSearchParams("type=t-mt&scope=mine"))).map((tab) => tab.active), [false, true, false]);
  assert.deepEqual(parse(tabs(new URLSearchParams("type=t-mt&view=board&scope=mine"))).map((tab) => tab.active), [false, false, true]);
  assert.doesNotMatch(app, /placeholder: "ค้นหาเลขที่ใบแจ้งซ่อม", scope: true/, "no second scope switch in the MT filter row");
});

test("TEST shows once: in the top bar, not again in the test-mode banner", () => {
  assert.match(app, /<span class="sandbox-pill" title="อยู่ในโหมดทดสอบ ข้อมูลแยกจากระบบจริง">TEST<\/span>/);
  assert.match(app, /<div class="sandbox-banner-copy"><strong>โหมดทดสอบ<\/strong>/);
});

test("RubberFlow overview: no recorded production shows an empty state, and chart axes never repeat a label", () => {
  const context = vm.createContext({ escapeHtml });
  context.window = context;
  vm.runInContext(read("modules/rubberflow-rules.js"), context);
  vm.runInContext(read("modules/rubberflow-ui.js"), context);
  const ui = context.MNP_RUBBERFLOW_UI;
  const ticksOf = (html) => [...html.matchAll(/text-anchor="end">([^<]+)<\/text>/g)].map((match) => match[1]);
  // ของเสีย 0% ทุกขั้นของล็อตจริงยังเป็นกราฟ (เดิมแกนเป็น "0, 1, 1")
  const zero = ui.dualChart({ labels: ["A", "B"], bars: [0, 0], leftName: "ของเสีย (%)" });
  assert.match(zero, /<svg/);
  assert.deepEqual(ticksOf(zero), ["0.0", "0.5", "1.0"]);
  const small = ticksOf(ui.dualChart({ labels: ["A", "B"], bars: [0.2, 0.4], leftName: "ของเสีย (%)" }));
  assert.equal(new Set(small).size, small.length, `axis labels are distinct: ${small.join(", ")}`);
  assert.deepEqual(ticksOf(ui.dualChart({ labels: ["A"], bars: [37], leftName: "m" })), ["0", "10", "20", "30", "40"], "whole steps stay whole numbers");
  const plan = read("modules/rubberflow-pages-plan.js");
  assert.match(plan, /const hasProduction = data\.lots\.some\(\(lot\) => lot\.goodQty \+ lot\.scrapQty > 0\);/);
  assert.equal(plan.match(/ui\.card\(!hasProduction \? noProduction : ui\.dualChart\(/g)?.length, 2, "both overview charts wait for recorded production");
});
