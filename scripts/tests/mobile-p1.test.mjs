// ผล critique G (P1 บนมือถือ): เปลี่ยนหน้าแล้วเริ่มบนสุด, ข้อความผิดไม่อยู่ใต้แถวปุ่มขั้น, แถบตัดสินใจบอกว่าเป็นของใบไหน
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

await import("../../modules/form-steps.js");
const steps = globalThis.MNP_FORM_STEPS;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const formSteps = read("modules/form-steps.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

// ดึง watchQueuePanelPlacement จาก app.js มารันจริงกับ IntersectionObserver/MutationObserver จำลอง
function loadPlacementWatcher() {
  const start = app.indexOf("let queuePanelObserver = null;");
  const end = app.indexOf("\n}", app.indexOf("function watchQueuePanelPlacement(")) + 2;
  assert.ok(start >= 0 && end > start, "watcher found in app.js");
  const observers = { io: [], mo: [] };
  class FakeIO { constructor(callback) { this.callback = callback; this.disconnected = false; observers.io.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class FakeMO { constructor(callback) { this.callback = callback; observers.mo.push(this); } observe() {} disconnect() {} }
  const context = vm.createContext({ IntersectionObserver: FakeIO, MutationObserver: FakeMO });
  vm.runInContext(`${app.slice(start, end)}\nthis.watch = watchQueuePanelPlacement;`, context);
  return { watch: context.watch, observers };
}

function fakePanel(state = "idle") {
  const classes = new Set();
  const panel = { dataset: { state }, classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) } };
  return { panel, li: { querySelector: (selector) => (selector === "#decision-panel" ? panel : null) } };
}

test("the floating decision bar steps away while its request is scrolled off screen, and only while idle", () => {
  const { watch, observers } = loadPlacementWatcher();
  const { panel, li } = fakePanel();
  watch(li);
  const [io] = observers.io;
  const [mo] = observers.mo;
  io.callback([{ isIntersecting: false }]);
  assert.equal(panel.classList.contains("is-away"), true, "idle and off screen: hidden");
  io.callback([{ isIntersecting: true }]);
  assert.equal(panel.classList.contains("is-away"), false, "back on screen: shown");
  // กำลังนับถอยหลังเลิกทำ: ต้องเห็นปุ่มเลิกทำเสมอ แม้ใบจะเลื่อนพ้นจอ
  panel.dataset.state = "pending";
  io.callback([{ isIntersecting: false }]);
  assert.equal(panel.classList.contains("is-away"), false, "pending stays visible");
  panel.dataset.state = "idle";
  mo.callback([]);
  assert.equal(panel.classList.contains("is-away"), true, "returning to idle while off screen hides it");
});

test("opening another request drops the previous watcher", () => {
  const { watch, observers } = loadPlacementWatcher();
  watch(fakePanel().li);
  watch(fakePanel().li);
  assert.equal(observers.io[0].disconnected, true);
  assert.equal(observers.io[1].disconnected, false);
});

test("decision buttons name their request, and the line shows only in the mobile home queue", () => {
  assert.match(app, /<p class="decision-target" id="decision-target">\$\{escapeHtml\(`\$\{request\.request_no\} · \$\{request\.title\}`\)\}<\/p>/);
  assert.match(app, /data-decision="\$\{escapeHtml\(item\.decision\)\}" aria-describedby="decision-target">/);
  assert.equal((app.match(/(?<!function )decisionPanelHtml\(\{ request, /g) ?? []).length, 2, "both the home queue and the detail page pass the request");
  assert.match(css, /\.decision-target \{ display: none; \}/);
  assert.match(css, /\.queue-item \.decision-panel\[data-state="idle"\] \.decision-target \{[^}]*display: block;/);
  assert.match(css, /\.queue-item \.action-panel\.is-away \{ visibility: hidden; transform: translateY\(110%\);/);
});

test("request A to request B, and list to create form, count as a new page; filters do not", () => {
  // ดึง routeFromHash + pageKeyOf จาก app.js มารันจริง
  const pick = (name) => {
    const start = app.indexOf(`function ${name}(`);
    return app.slice(start, app.indexOf("\n}", start) + 2);
  };
  const context = vm.createContext({ URLSearchParams });
  vm.runInContext(`${pick("routeFromHash")}\n${pick("pageKeyOf")}\nthis.key = (hash) => pageKeyOf(routeFromHash(hash));`, context);
  const same = (a, b) => context.key(a) === context.key(b);
  assert.equal(same("#/request?id=req-a", "#/request?id=req-b"), false, "the next request in the queue opens at the top");
  assert.equal(same("#/requests?type=t-mt", "#/requests?type=t-mt&mode=create&createType=t-mt"), false, "list to create form");
  assert.equal(same("#/requests?type=t-mt", "#/requests?type=t-mg"), false, "another module");
  assert.equal(same("#/requests?type=t-mt", "#/requests?type=t-mt&status=pending_approval"), true, "a status filter keeps the place");
  assert.equal(same("#/requests?type=t-mt&scope=mine&q=HCM", "#/requests?type=t-mt"), true, "scope and search keep the place");
  assert.equal(same("#/ncr?id=n1", "#/ncr?id=n2"), false);
});

test("a page change starts at the top, going back restores the old position, and a filter change keeps it", () => {
  assert.match(app, /if \(pageChanged && savedY === null\) window\.scrollTo\(0, 0\);/);
  assert.match(app, /if \(pageChanged && savedY !== null\) window\.scrollTo\(0, savedY\);/);
  assert.match(app, /focusRouteStart\(\{ samePath: !pageChanged, beforeId \}\);/);
  // Safari จำกัด replaceState: เขียนเมื่อหยุดเลื่อนและตอนแตะลิงก์ในแอป และไม่ให้ข้อผิดพลาดหลุดออกมา
  assert.match(app, /try \{ history\.replaceState\(\{ \.\.\.\(history\.state \?\? \{\}\), pilotScrollY: Math\.round\(window\.scrollY\) \}, ""\); \} catch/);
  assert.match(app, /document\.addEventListener\("click", \(event\) => \{ if \(event\.target\.closest\?\.\("a\[href\^='#'\]"\)\) saveScrollMemo\(\); \}, true\);/);
});

test("form errors scroll to the middle of the screen and the step bar counts what is missing", () => {
  assert.match(steps.actionsHtml({ cancelHref: "#/", submitLabel: "ส่ง" }), /<p class="stepped-summary" data-steps-summary hidden><\/p>/);
  assert.match(formSteps, /target\.focus\(\{ preventScroll: true \}\);/);
  assert.match(formSteps, /\(field\?\.querySelector\("\.field-error\[data-generated\]"\) \?\? field\)\?\.scrollIntoView\?\.\(\{ block: "center" \}\);/);
  assert.match(formSteps, /`ยังมี \$\{missing\} ช่องที่ต้องแก้`/);
  assert.match(css, /\.stepped-form:not\(\.is-stepped\) \.stepped-summary \{ display: none; \}/, "wide screens already show every error");
  // MutationObserver ฟังฟอร์มทั้งฟอร์ม: เขียนข้อความเฉพาะเมื่อเปลี่ยน ไม่งั้นวนไม่จบ (หน้าค้าง)
  assert.match(formSteps, /if \(summary\.textContent !== text\) summary\.textContent = text;/);
  assert.match(formSteps, /if \(summary\.hidden !== !missing\) summary\.hidden = !missing;/);
});
