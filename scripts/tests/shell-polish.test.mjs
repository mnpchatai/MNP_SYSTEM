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
  assert.equal(clip("กี่".repeat(81), 80), `${"กี่".repeat(79)}…`, "a Thai consonant with its vowel and tone mark counts as one, so no tone mark is cut off");
  assert.equal(clip("😀".repeat(5), 4), "😀😀😀…", "never splits a surrogate pair");
  assert.equal(clip(null, 10), "");
  assert.equal(clip("ไม่ผ่านเพราะ", 7), "ไม่ผ่าน…", "never ends on a leading vowel whose consonant was cut");
  assert.equal(clip("ไม่ผ่านเพราะ", 8), "ไม่ผ่านเพ…");
  // ใน app.js ส่วนที่เหลือของตัวจัดการแป้น: A/R ไม่ตัดสินใบที่เลือกเมื่อโฟกัสอยู่ที่แถวงาน
  assert.match(app, /if \(target instanceof HTMLElement && target\.closest\("\.queue-item\.is-task"\)\) return;\n  const panel = document\.querySelector\("#decision-panel"\);/);
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

test("the selected row shows one focus ring, not two, and keeps the button's outline (visible in forced colours)", () => {
  assert.match(css, /\.queue-item\.is-selected:has\(\.queue-item-main:focus-visible\) \{ box-shadow: none; \}/);
  assert.doesNotMatch(css, /\.queue-item\.is-selected \.queue-item-main:focus-visible \{ outline: none; \}/);
});

test("header icon buttons are 40px only on mouse screens; touch screens keep 44px", () => {
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 761px\) \{ \.top-actions \.icon-button \{ width: 40px; height: 40px; \} \}/);
  assert.equal(css.match(/\.top-actions \.icon-button \{ width: 40px/g)?.length, 1, "no unconditional 40px rule that would beat the touch rule");
  // กฎ 44px ของจอสัมผัสยังอยู่ (ในบล็อก coarse ท้ายไฟล์) และกฎ 40px มีเงื่อนไข จึงไม่ชนะมันบนจอสัมผัส
  assert.match(css, /\n {2}\.icon-button, \.request-detail-menu > \.icon-button \{ width: 44px; height: 44px; \}/);
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

// ---- เริ่มงาน เสร็จสิ้นงาน ตรวจรับ: ยืนยันหรือยกเลิก แล้วส่งทันที ไม่มีนับถอยหลัง (app.js confirmStepAction) ----
function stepConfirmHarness() {
  const timers = [];
  let clock = 0;
  const fakeTimers = {
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + ms, every: 0 }); return timers.length; },
    setInterval: (fn, ms) => { timers.push({ fn, at: clock + ms, every: ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  };
  const advance = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.fn && timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock = next.at;
      const fn = next.fn;
      if (next.every) next.at += next.every; else next.fn = null;
      fn();
      await Promise.resolve();
    }
    clock = end;
    await new Promise((resolve) => setImmediate(resolve));
  };
  const windowListeners = {};
  const element = () => {
    const node = { children: [], buttons: [], textContent: "", className: "", attrs: {}, listeners: {}, isConnected: true };
    node.setAttribute = (name, value) => { node.attrs[name] = value; };
    node.addEventListener = (type, fn) => { (node.listeners[type] ??= []).push(fn); };
    node.replaceChildren = (...nodes) => { node.children = nodes; };
    Object.defineProperty(node, "childNodes", { get: () => node.children });
    Object.defineProperty(node, "innerHTML", {
      set: (html) => { node.buttons = [...html.matchAll(/data-step-action="([^"]+)"[^>]*>([^<]*)</g)].map(([, action, text]) => ({ action, textContent: text, focus() {}, closest() { return this; }, dataset: { stepAction: action } })); },
      get: () => node.buttons.map((button) => button.textContent).join("|"),
    });
    node.querySelector = (selector) => {
      const action = selector.match(/data-step-action="([^"]+)"/)?.[1];
      if (action) return node.buttons.find((button) => button.action === action) ?? null;
      return node.children.find((child) => child.tag === "button") ?? null;
    };
    return node;
  };
  const context = {
    escapeHtml, DECISION_UNDO_SECONDS: 5, activeDecisionCountdown: null, Intl, Array, String,
    document: { createElement: element, addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "visible" },
    location: { hash: "#/request?id=r1" },
  };
  context.window = {
    addEventListener: (type, fn) => { (windowListeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] ?? []).filter((item) => item !== fn); },
    ...fakeTimers,
  };
  vm.createContext(context);
  vm.runInContext(read("modules/request-decision.js"), context);
  vm.runInContext(`${functionSource("clipText")}\n${functionSource("confirmStepAction")}\nthis.confirmStepAction = confirmStepAction;`, context);
  const area = element();
  const focused = [];
  const original = { tag: "button", isConnected: true, focus() { focused.push("original"); } };
  area.children = [original];
  const line = () => area.children[0];
  const buttonsOf = () => area.children[1];
  // detail 0 = แป้นพิมพ์/โปรแกรม (ราวกันแตะซ้ำไม่กัน) · detail 1 = นิ้ว/เมาส์
  const click = (action, detail = 0) => buttonsOf().listeners.click[0]({ target: { closest: () => buttonsOf().buttons.find((button) => button.action === action) }, detail });
  Object.assign(context, { focused });
  return { context, area, original, line, buttonsOf, click, advance, windowListeners };
}

test("closing a repair step asks to confirm or cancel, and confirming sends at once with no countdown", async () => {
  const h = stepConfirmHarness();
  const sent = [];
  const start = () => h.context.confirmStepAction(h.area, { label: "ไม่ผ่านการตรวจรับ", requestNo: "MT-2569-0390", consequence: "ส่งกลับให้ช่างซ่อมเพิ่มเติม", tone: "danger", echo: "ไฟยัง  กะพริบ", send: async () => { sent.push(1); return true; } });
  start();
  assert.equal(h.line().textContent, "ไม่ผ่านการตรวจรับ MT-2569-0390 → ส่งกลับให้ช่างซ่อมเพิ่มเติม · “ไฟยัง กะพริบ”", "the confirm line names the request, what happens next and the typed note");
  assert.deepEqual(h.buttonsOf().buttons.map((button) => button.action), ["cancel", "confirm"]);
  h.click("cancel");
  assert.deepEqual(h.area.children, [h.original], "cancel puts the original buttons back");
  assert.equal(sent.length, 0);

  start();
  h.click("confirm");
  await h.advance(0);
  assert.equal(sent.length, 1, "confirm sends immediately");
  assert.doesNotMatch(functionSource("confirmStepAction"), /createCountdown|เลิกทำ/, "no undo countdown for these steps (the user's rule)");
});

test("a failed send gives the buttons back so the step can be tried again", async () => {
  const h = stepConfirmHarness();
  h.context.confirmStepAction(h.area, { label: "เริ่มงาน", requestNo: "MT-1", send: async () => false });
  h.click("confirm");
  await h.advance(0);
  assert.deepEqual(h.area.children, [h.original]);
});


test("the MT start, finish and verify steps all go through the confirm helper; the verifier sees the repair result first", () => {
  const mt = read("modules/module-mt.js");
  assert.equal(mt.match(/confirmStepAction\(/g)?.length, 3);
  for (const label of ['label: "เริ่มงาน"', 'label: "เสร็จสิ้นงาน"', 'label: pass ? "ผ่านการตรวจรับ" : "ไม่ผ่านการตรวจรับ"']) assert.ok(mt.includes(label), label);
  assert.doesNotMatch(mt, /✓ ผ่าน|✕ ไม่ผ่าน/, "icons instead of characters a screen reader reads aloud");
  assert.match(mt, /<div class="detail-action" id="repair-verify"><h3>ตรวจรับผลการซ่อม<\/h3>\$\{verifySummaryHtml\(request\)\}<div class="field" data-field="verify_note"><label for="verify-note">หมายเหตุ <span class="field-required">\(จำเป็นเมื่อไม่ผ่าน\)<\/span><\/label>/, "the repair result comes before the pass/fail buttons, and the note's rule sits on its label");
  assert.match(mt, /request\.cause_analysis && !canVerify \?/, "and is not repeated in the facts card");
  assert.match(mt, /<label for="finish-cause">วิเคราะห์สาเหตุ\$\{REQUIRED\}<\/label>/);
  assert.match(css, /:is\(\.approval-actions, \.form-actions\):has\(> \.step-confirm\) \{/);
});

test("NCR dashboard departments wear their own department palette; loss types have their own colour set", () => {
  const dashboard = read("modules/module-ncr-dashboard.js");
  assert.match(dashboard, /DEPT_PALETTES\.has\(dept\) \? `dpt dpt-\$\{dept\}` : "dco"/);
  assert.match(dashboard, /`lc\$\{typeKeys\.indexOf\(type\) \+ 1\}` : "lco"/);
  for (const code of ["MT", "RB", "QA", "FT", "AD"]) assert.match(css, new RegExp(`\\[data-dept-code="${code}"\\], \\.nd \\.dpt-${code} \\{`), `${code} chart colour comes from its palette`);
  assert.match(css, /\.nd \.dpt \{ background: var\(--m600\); \}/);
  assert.doesNotMatch(css, /--dept-\d/, "the old alphabetical ramp is gone");
  assert.doesNotMatch(dashboard, /บาทในรายการนี้เป็นค่าขั้นต่ำ/, "the minimum-amount caveat is said once, in the summary line");
});

test("dashboard touch targets reach 44px and whole table rows open the request", () => {
  assert.match(css, /\.nd :is\(\.nd-pill, \.nd-more summary, \.nd-rowbtn, \.nd-chip, \.nd-brow\) \{ min-height: 44px; \}/, "more specific than the base rules declared later in the file");
  assert.match(css, /\.nd \.nd-rowbtn \{ min-width: 44px; \}/);
  assert.match(css, /\.note-toggle \{ width: 44px; height: 44px;/, "the ⓘ note button is a 44px target on touch");
  assert.match(css, /\.nd-rowlink a\.request-no::after \{ content: ""; position: absolute; inset: 0; \}/);
  assert.match(css, /\.note-body \{ max-width: 70ch;/);
});

test("leaving the page while the step is still sending: it finishes, but tells the caller not to redraw the old request", async () => {
  const h = stepConfirmHarness();
  const seen = [];
  let finish;
  h.context.confirmStepAction(h.area, { label: "เริ่มงาน", requestNo: "MT-1", send: ({ stillHere }) => new Promise((resolve) => { finish = () => { seen.push(stillHere()); resolve(true); }; }) });
  h.click("confirm");
  h.context.location.hash = "#/dashboard";
  finish();
  await h.advance(0);
  assert.deepEqual(seen, [false], "stillHere() is false so the caller skips renderRequestDetail");
  const mt = read("modules/module-mt.js");
  assert.equal(mt.match(/if \(stillHere\(\)\) \{ await renderRequestDetail\(params\); focusDetailHeading\(\); \}/g)?.length, 3, "all three MT steps only redraw when still on the page, then focus the request heading instead of dropping to the page");
});

test("the tap guard only holds back the confirm button; cancel answers at once", () => {
  const h = stepConfirmHarness();
  const sent = [];
  h.context.confirmStepAction(h.area, { label: "เริ่มงาน", requestNo: "MT-1", send: async () => { sent.push(1); return true; } });
  h.click("confirm", 1);
  assert.equal(sent.length, 0, "a tap landing right where the first tap was does not confirm");
  assert.deepEqual(h.buttonsOf().buttons.map((button) => button.action), ["cancel", "confirm"]);
  h.click("cancel", 1);
  assert.deepEqual(h.area.children, [h.original], "cancel works immediately");
});

test("typed inputs are locked while confirming, released on cancel, and focus returns to the button that was pressed", () => {
  const h = stepConfirmHarness();
  const note = { disabled: false };
  const files = { disabled: false };
  const pressed = { tag: "button", isConnected: true, focus() { h.context.focused.push("pressed"); } };
  h.context.confirmStepAction(h.area, { label: "ไม่ผ่านการตรวจรับ", requestNo: "MT-1", tone: "danger", lock: [note, files, null], trigger: pressed, send: async () => true });
  assert.deepEqual([note.disabled, files.disabled], [true, true], "what is sent is what was on screen when confirming");
  h.click("cancel");
  assert.deepEqual([note.disabled, files.disabled], [false, false]);
  assert.equal(h.context.focused.at(-1), "pressed");
});

test("closing the tab is warned against while the step is sending, and the warning goes away after", async () => {
  const h = stepConfirmHarness();
  let finish;
  h.context.confirmStepAction(h.area, { label: "เสร็จสิ้นงาน", requestNo: "MT-1", send: () => new Promise((resolve) => { finish = resolve; }) });
  assert.equal((h.windowListeners.beforeunload ?? []).length, 0, "no warning just for opening the confirm step");
  h.click("confirm");
  const warn = h.windowListeners.beforeunload.at(-1);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  warn(event);
  assert.equal(event.prevented, true, "still sending");
  finish(true);
  await h.advance(0);
  assert.equal((h.windowListeners.beforeunload ?? []).includes(warn), false, "the warning is removed once sent");
});

test("one detail template: start work sits with the approval buttons; assign, finish and verify are the top-left action card with their own buttons", () => {
  const mt = read("modules/module-mt.js");
  const app = read("app.js");
  assert.match(mt, /asideHtml: `\$\{canStartWork \? `<section class="card action-panel step-panel" id="repair-start-panel"/);
  // ผู้ใช้กำหนด 2026-11-12: ปุ่มของฟอร์มอยู่กับช่องของฟอร์ม (ตรวจรับ: หมายเหตุกับผ่าน/ไม่ผ่านอยู่การ์ดเดียว)
  assert.doesNotMatch(mt, /repair-verify-panel/);
  assert.match(mt, /actionHtml: `/);
  assert.match(app, /<section class="card detail-actions" aria-labelledby="detail-actions-title"><h2 id="detail-actions-title">สิ่งที่คุณต้องดำเนินการ<\/h2>\$\{detailView\.actionHtml\}<\/section>/);
  assert.match(css, /:is\(\.ncr-actions, \.detail-actions\) :is\(\.form-actions, \.approval-actions\) \{ position: sticky;/, "submit buttons pinned to the bottom on phones, like NCR");
  assert.doesNotMatch(mt, /<section class="card"><h2>เริ่มงานซ่อม<\/h2>/, "start work is no longer an in-flow card");
  assert.match(mt, /const section = document\.querySelector\("#repair-verify"\);/, "the note and files stay in the verify card");
  assert.match(app, /\$\{canApprove \? "" : detailView\?\.asideHtml \?\? ""\}/);
  assert.match(css, /\.step-panel \.approval-actions \{ margin: 0; padding: 0; border-top: 0; \}/);
});
