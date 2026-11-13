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
  // รอบรวม 20: หน้ารายละเอียดไม่ทวนเลขที่ใบ (หัวใบบอกแล้ว) คิวหน้าหลักยังบอก
  assert.match(app, /setLine\(`กำลังจะ\$\{labelOf\(state\.decision\)\}\$\{onDecided \? ` \$\{request\.request_no\}` : ""\}\$\{state\.comment \? ` · “\$\{clipText\(state\.comment, 80\)\}”` : ""\}`\);/);
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

test("header icon buttons are 44px on every screen, like the 44px button rule", () => {
  // รอบรวม 20: ผู้ใช้กำหนดปุ่มจอคอม 44px ปุ่มไอคอนบนหัวจึง 44px ด้วย
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 761px\) \{ \.top-actions \.icon-button \{ width: 44px; height: 44px; \} \}/);
  assert.match(css, /\.request-detail-menu > \.icon-button \{ width: 44px; height: 44px;/);
  assert.match(css, /\.request-back-link \{ min-height: 44px;/);
  // กฎ 44px ของจอสัมผัสยังอยู่ (ในบล็อก coarse ท้ายไฟล์) และกฎ 40px มีเงื่อนไข จึงไม่ชนะมันบนจอสัมผัส
  assert.match(css, /\n {2}\.icon-button, \.request-detail-menu > \.icon-button \{ width: 44px; height: 44px; \}/);
});

test("a module list has one scope control: mine is a subset of what I may see, the board tracks every request", () => {
  const context = vm.createContext({ window: {}, URLSearchParams });
  context.window = context;
  vm.runInContext(read("modules/request-center.js"), context);
  const tabs = load("requestsViewTabs", { escapeHtml, requestCenterUrl: context.MNP_REQUEST_CENTER.url });
  const parse = (html) => [...html.matchAll(/<a class="view-tab( active)?"(?: aria-current="page")? href="([^"]+)" title="[^"]+">([^<]+)<\/a>/g)].map((match) => ({ active: Boolean(match[1]), href: match[2].replaceAll("&amp;", "&"), label: match[3] }));
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
  assert.match(mt, /<div class="detail-action" id="repair-verify"><h3>ตรวจรับงาน<\/h3>\$\{verifySummaryHtml\(request\)\}<div class="field" data-field="verify_note"><label for="verify-note">หมายเหตุ <span class="field-required">\(จำเป็นเมื่อไม่ผ่าน\)<\/span><\/label>/, "the repair result comes before the pass/fail buttons, and the note's rule sits on its label");
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
  // รอบ 22: ปุ่มกรองช่วง ปุ่มชื่อแผนก และปุ่ม ⓘ 44px ทุกจอ (เดสก์ท็อปด้วย) ในกฎฐาน
  assert.match(css, /\.nd-rowbtn \{ min-height: 44px; min-width: 44px; padding: 0;/);
  assert.match(css, /\.nd-chip \{ min-height: 44px;/);
  assert.match(css, /\.note-toggle \{ flex: none; width: 44px; height: 44px; margin-block: -6px;/, "the ⓘ note button is a 44px target on every screen");
  assert.doesNotMatch(css, /\.note-toggle \{[^}]*width: 32px/);
  // แถบค้นหารายการ: ปุ่มค้นหา/ล้างสูงเท่าช่องค้นหา ชื่อช่องใช้ได้ทั้งคำร้องและทะเบียน NCR
  assert.match(app, /aria-label="ค้นหาในรายการ" aria-keyshortcuts="\/"/);
  assert.match(app, /<button class="btn secondary" type="submit">ค้นหา<\/button>/);
  // แถวรวมของตารางแผนกไม่ซ้ำตัวเลขในการ์ด: ทั้งสองแดชบอร์ดไม่มีแถวรวม (ยอดรวมอยู่ในการ์ดตัวเลข)
  for (const file of ["modules/module-ncr-dashboard.js", "modules/module-mt-dashboard.js"]) assert.doesNotMatch(read(file), /nd-total|รวม \(ไม่ซ้ำ\)/, file);
  assert.doesNotMatch(css, /tr\.nd-total/);
  // ชิปตัวกรองของรายการสูงเท่าชิปแดชบอร์ด · ป้ายในการ์ดตัวเลขขึ้นบรรทัดใหม่ได้ ไม่ล้นการ์ดบนจอ 375px
  assert.match(css, /\.filter \{ min-height: 44px;/);
  assert.match(css, /\.nd-tile \.nd-pill \{ max-width: 100%; white-space: normal; \}/);
  // แผนกที่รับผิดชอบหลายแผนกคั่นด้วย " + " ทั้งทะเบียนและหน้ารายละเอียด NCR
  assert.match(read("modules/module-ncr.js"), /const responsibilities = escapeHtml\(\(ncr\.ncr_responsibilities \?\? \[\]\)\.map\(\(item\) => relation\(item\.department\)\?\.code \?\? ""\)\.join\(" \+ "\)\);/);
  assert.match(read("modules/module-ncr.js"), /<div class="ncr-action-group"><h3>ผู้ตอบของแผนก \(ถ้ามี\)<\/h3>/);
  assert.match(read("modules/module-ncr-dashboard.js"), /\$\{fmtNumber\(sums\.assessed\)\}<small> \/ \$\{fmtNumber\(sums\.need\)\} ใบ<\/small>/);
  // ไอคอนเตือนในป้ายแดชบอร์ดมาจาก mask SVG ไม่มีอักษร ▲
  for (const file of ["modules/module-ncr-dashboard.js", "modules/module-mt-dashboard.js"]) assert.doesNotMatch(read(file), /▲/, file);
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
  // รอบ 17: ฟอร์มของขั้นเริ่มด้วยรายละเอียดที่ผู้ขอแจ้ง (ที่เดียวบนหน้า ไม่มีการ์ดแยกซ้ำ)
  assert.match(app, /<section class="card detail-actions" aria-labelledby="detail-actions-title"><h2 id="detail-actions-title">\$\{actionWorkTitle\}<\/h2>\$\{briefInAction \? `<div class="detail-actions-brief">\$\{briefBodyHtml\}<\/div>` : ""\}\$\{actionWorkHtml\}<\/section>/);
  assert.match(app, /const briefInAction = Boolean\(moduleWorkHtml\) && Boolean\(description\);/);
  // รอบรวม 20: การ์ดที่มีแค่ฟอร์มตอบกลับ (ไม่บังคับ) รายละเอียดขึ้นก่อน
  assert.match(app, /\$\{!moduleWorkHtml && !briefInAction \? `<section class="card request-brief" aria-labelledby="request-brief-title">\$\{briefBodyHtml\}<\/section>` : ""\}/);
  assert.match(app, /\$\{briefInAction \|\| !moduleWorkHtml \? "" : `<section class="card request-brief" aria-labelledby="request-brief-title">\$\{briefBodyHtml\}<\/section>`\}/);
  // รอบ 12: การ์ดที่มีแค่ฟอร์มตอบกลับความเห็น (ไม่บังคับ) ไม่บอกว่า "ต้องดำเนินการ" · ขั้นที่ตอบแล้วพับเป็น "ตอบเพิ่มเติม"
  assert.match(app, /const actionWorkTitle = moduleWorkHtml \? "สิ่งที่คุณต้องดำเนินการ" : "ตอบกลับความเห็น \(ถ้าต้องการ\)";/);
  assert.match(app, /replies\.some\(\(reply\) => reply\.approval_step_id === step\.id\)\n    \? `<details class="detail-reply-more">/);
  // รอบ 11: การ์ดงานรวมงานของโมดูลกับฟอร์มตอบกลับความเห็น · ประวัติเอกสารการ์ดเดียว เปิดไว้เสมอ (คำร้อง/MT และ NCR ใช้ historyCardHtml)
  assert.match(app, /const moduleWorkHtml = \(detailView\?\.actionHtml \?\? ""\)\.trim\(\);/);
  assert.match(app, /const actionWorkHtml = `\$\{moduleWorkHtml\}\$\{replyWorkHtml\}`\.trim\(\);/);
  assert.match(app, /function historyCardHtml\(itemsHtml, footHtml = ""\) \{/);
  assert.doesNotMatch(app, /<summary><h2>ลำดับอนุมัติ<\/h2><\/summary>|<summary><h2>ลำดับเหตุการณ์<\/h2><\/summary>/, "no collapsed history cards");
  assert.match(read("modules/module-ncr.js"), /const historySection = historyCardHtml\(/);
  assert.match(css, /:is\(\.ncr-actions, \.detail-actions\) :is\(\.form-actions, \.approval-actions\) \{ position: sticky;/, "submit buttons pinned to the bottom on phones, like NCR");
  assert.doesNotMatch(mt, /<section class="card"><h2>เริ่มงานซ่อม<\/h2>/, "start work is no longer an in-flow card");
  assert.match(mt, /const section = document\.querySelector\("#repair-verify"\);/, "the note and files stay in the verify card");
  assert.match(app, /\$\{canApprove \? "" : detailView\?\.asideHtml \?\? ""\}/);
  assert.match(css, /\.step-panel \.approval-actions \{ margin: 0; padding: 0; border-top: 0; \}/);
});

test("every work card the viewer acts in has one heading (user decision 2026-11-13)", () => {
  const mt = read("modules/module-mt.js");
  const ncr = read("modules/module-ncr.js");
  assert.match(app, /<h2 id="decision-panel-title">สิ่งที่คุณต้องดำเนินการ<\/h2>/, "approver panel");
  assert.match(mt, /<h2 id="repair-start-title">สิ่งที่คุณต้องดำเนินการ<\/h2>/, "MT start-work panel");
  assert.match(app, /const actionWorkTitle = moduleWorkHtml \? "สิ่งที่คุณต้องดำเนินการ"/, "module work card");
  assert.match(ncr, /<h2>สิ่งที่คุณต้องดำเนินการ<\/h2>/, "NCR work card");
  for (const source of [app, mt]) assert.doesNotMatch(source, />(พิจารณาคำร้อง|ขั้นถัดไปของคุณ)</);
});

test("round 23: conditional requirements are said in the label, summaries and the queue checkbox name what they do", () => {
  const lossForm = read("modules/ncr-loss-form.js");
  assert.match(lossForm, /<label for="ncr-loss-note">รายละเอียด \/ หมายเหตุ \(จำเป็นเมื่อประเภทเป็น อื่น ๆ\)<\/label>/);
  assert.match(lossForm, /<label for="ncr-review-note">หมายเหตุ \/ เหตุผลกรณีไม่มีความสูญเสีย \(จำเป็นเมื่อไม่มีความสูญเสีย\)<\/label>/);
  const board = read("modules/module-ncr-dashboard.js");
  assert.match(board, /<summary>ดูรายละเอียดยอดสุทธิ<\/summary>/);
  assert.match(board, /<summary>ดูรายละเอียดการประเมิน<\/summary>/);
  assert.doesNotMatch(board, /<summary>ดูรายละเอียด<\/summary>/);
  assert.match(app, /aria-label="เลือก \$\{escapeHtml\(request\.request_no\)\} เพื่อตัดสินหลายรายการ"/);
});

test("round 24 (gaps to a 4): plain-language errors, step position, offline notice, help for every page, unsent text guard", async () => {
  const vm = await import("node:vm");
  // H9: ข้อความเทคนิคไม่ถึงผู้ใช้ เน็ตหลุดบอกว่าข้อมูลยังอยู่ ข้อความไทยของเราเองผ่านตามเดิม
  const start = app.indexOf("const NETWORK_ERROR_PATTERN");
  const source = app.slice(start, app.indexOf("\n}\n", app.indexOf("function unmappedErrorText(")) + 3);
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.fn = unmappedErrorText;`, context);
  const offline = "เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด ลองอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  assert.equal(context.fn("TypeError: Failed to fetch"), offline);
  assert.equal(context.fn("Load failed"), offline, "Safari's wording");
  assert.equal(context.fn("The network connection was lost."), offline);
  assert.doesNotMatch(context.fn("canceling statement due to statement timeout"), /สัญญาณ/, "a database timeout is not a network problem");
  assert.doesNotMatch(offline, /ส่งไม่สำเร็จ/, "callers already prefix ส่งไม่สำเร็จ");
  assert.equal(context.fn("แนบไฟล์ไม่สำเร็จ 1 จาก 2 ไฟล์"), "แนบไฟล์ไม่สำเร็จ 1 จาก 2 ไฟล์");
  assert.equal(context.fn('duplicate key value violates unique constraint "x"'), "เกิดข้อผิดพลาดที่ระบบ ลองอีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ");
  assert.match(app, /STEP_NOT_PENDING: "รายการนี้ถูกดำเนินการแล้ว โหลดหน้าใหม่เพื่อดูสถานะล่าสุด"/);
  // H1: ลำดับขั้นบนหน้ารายละเอียด · แถบไม่มีสัญญาณ
  const verbsContext = vm.createContext({});
  vm.runInContext(read("modules/step-verb.js"), verbsContext);
  const verbs = verbsContext.MNP_STEP_VERB;
  assert.equal(verbs.stepLineText({ currentStepName: "ผู้จัดการโรงงาน", nextStepName: "ผู้จัดการทั่วไป", position: 1, total: 2 }), "อนุมัติขั้นที่ 1 จาก 2: ผู้จัดการโรงงาน · ถัดไป: ผู้จัดการทั่วไป");
  assert.equal(verbs.stepLineText({ currentStepName: "ผู้จัดการทั่วไป", position: 1, total: 1, afterLast: "มอบหมายช่าง" }), "ขั้นตอน: ผู้จัดการทั่วไป · ถัดไป: มอบหมายช่าง", "a one-step request does not count");
  assert.match(app, /decisionPanelHtml\(\{ request, currentStep, nextStep, steps, extraDecisions/);
  assert.match(app, /window\.addEventListener\("offline", syncOnlineState\);/);
  assert.match(css, /\.offline-banner \{ position: fixed;/);
  // H10: ทุกหน้าหลักมีคำแนะนำ รวมการแจ้งเตือน · NCR บอกส่วนของใบและวิธีนับกำหนดตอบ
  const helpContext = vm.createContext({});
  vm.runInContext(read("modules/shortcut-help.js"), helpContext);
  const help = helpContext.MNP_SHORTCUT_HELP.PAGE_HELP;
  assert.ok(help.notifications.length >= 2);
  assert.match(help.ncr.join(" "), /กำหนดตอบ = วันออกใบ \+ 5 วัน/);
  // H4/H5: ขั้นต่ำของเหตุผลบอกก่อนส่ง · ทางล้างตัวกรองทางเดียว · แถวแจ้งเตือนมีไอคอน · รหัสผ่านใหม่บอกขั้นต่ำ
  assert.match(app, /<small class="field-hint" id="decision-comment-hint" hidden>อย่างน้อย \$\{window\.MNP_REQUEST_DECISION\?\.MIN_COMMENT_LENGTH \?\? 3\} ตัวอักษร<\/small>/);
  assert.match(app, /panel\.querySelector\("#decision-comment-hint"\)\.hidden = !needsComment;/);
  assert.match(css, /\.app-shell:has\(\.empty-state > a\.btn\) \.board-search > a\.btn \{ display: none; \}/);
  assert.match(app, /<span class="notification-icon" aria-hidden="true">\$\{uiIcon\(icon\)\}<\/span>/);
  assert.match(app, /id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร<\/small>/);
  // H3/H5: ข้อความที่พิมพ์ค้างถามก่อนออก (ฟอร์มขั้น NCR มีร่างในเครื่องจึงไม่อยู่ในรายการ)
  assert.match(app, /const UNSAVED_TEXT_SELECTOR = '#decision-comment, textarea\[id\^="step-reply-"\], #resubmit-comment, #finish-cause, #verify-note';/);
  assert.match(app, /if \(panel && panel\.dataset\.state !== "compose"\) return false;/);
});

test("round 24: the leave guard asks once for typed text, and Back proceeds after the user confirms (no loop)", async () => {
  const vm = await import("node:vm");
  const start = app.indexOf("function pendingAttachmentCount() {");
  const end = app.indexOf("}, true);\n", start) + "}, true);\n".length;
  const field = (value, { defaultValue = "", disabled = false, state = null } = {}) => ({ value, defaultValue, disabled, readOnly: false, closest: (selector) => (selector === "#decision-panel" ? (state ? { dataset: { state } } : null) : null) });
  let fields = [];
  const listeners = {};
  const traversed = [];
  const asked = [];
  const context = vm.createContext({
    document: { querySelector: () => null, querySelectorAll: () => fields, addEventListener() {} },
    window: { addEventListener() {}, navigation: { addEventListener: (type, handler) => { listeners[type] = handler; }, traverseTo: (key, options) => traversed.push([key, options]) } },
    location: { hash: "" },
    confirmDialog: async (options) => { asked.push(options.title); return true; },
  });
  vm.runInContext(app.slice(start, end), context);
  const navigate = (info) => { const event = { navigationType: "traverse", cancelable: true, info, destination: { key: "k1" }, prevented: false, preventDefault() { this.prevented = true; } }; listeners.navigate(event); return event; };

  fields = [field("พิมพ์ค้าง", { state: "compose" })];
  const first = navigate();
  assert.equal(first.prevented, true, "typed text stops Back once");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(asked, ["ยังไม่ได้ส่งข้อความที่พิมพ์ไว้"]);
  assert.deepEqual(JSON.parse(JSON.stringify(traversed)), [["k1", { info: "leave-confirmed" }]]);
  assert.equal(navigate("leave-confirmed").prevented, false, "the confirmed traversal is not asked again");

  fields = [field("พิมพ์ค้าง", { state: "pending" })];
  assert.equal(navigate().prevented, false, "a decision already counting down is not unsent text");
  fields = [field("กำลังส่ง", { disabled: true })];
  assert.equal(navigate().prevented, false, "a field locked while sending is not unsent text");
  fields = [field("ข้อความเดิม", { defaultValue: "ข้อความเดิม" })];
  assert.equal(navigate().prevented, false, "unchanged pre-filled text is not a change");
  fields = [field("", { defaultValue: "ข้อความเดิม" })];
  assert.equal(navigate().prevented, true, "clearing pre-filled text is an unsent change");
});

test("round 24 (second pass): approval count wording, MT minimum hints, in-app reason dialog, reload action, role-aware help", () => {
  const mt = read("modules/module-mt.js");
  const ncr = read("modules/module-ncr.js");
  assert.match(read("modules/step-verb.js"), /`อนุมัติขั้นที่ \$\{position\} จาก \$\{total\}: \$\{currentStepName\}`/, "the panel counts approval steps, not the whole job");
  assert.match(mt, /<small class="field-hint" id="finish-cause-hint">อย่างน้อย 3 ตัวอักษร<\/small>/);
  assert.match(mt, /<small class="field-hint" id="verify-note-hint">เมื่อไม่ผ่าน อย่างน้อย 3 ตัวอักษร<\/small>/);
  assert.match(mt, /<summary><h2>แก้การมอบหมายช่าง<\/h2><\/summary>/, "one edit verb on the MT page (แก้กำหนดเสร็จ)");
  assert.doesNotMatch(ncr, /window\.prompt\(/, "no browser prompt for the void reason");
  assert.match(ncr, /await textPromptDialog\(\{ title: "ยกเลิกรายการความสูญเสียนี้\?", label: "เหตุผลที่ยกเลิก \(จำเป็น\)", hint: `อย่างน้อย \$\{VOID_REASON_MIN\} ตัวอักษร`, minLength: VOID_REASON_MIN/);
  assert.match(app, /if \(\[\.\.\.text\]\.length < minLength\) \{/, "the dialog checks the minimum and keeps the typed text");
  assert.match(app, /const STALE_STATE_HINT = "โหลดหน้าใหม่เพื่อดูสถานะล่าสุด";/);
  assert.match(app, /reload\.textContent = "โหลดสถานะล่าสุด";\r?\n\s+reload\.addEventListener\("click", async \(\) => \{\r?\n\s+if \(leaveWarningPending\(\) && !\(await confirmLeave\(\)\)\) return;/, "reloading asks first when typed text would be lost");
  assert.match(app, /dialog\.addEventListener\("close", \(\) => finish\(null\), \{ once: true \}\);\r?\n\s+dialog\.showModal\(\);\r?\n\s+field\.focus\(\);/);
  assert.match(css, /\.confirm-dialog \.field-error \{ margin: 6px 0 0; color: var\(--danger-ink\);/);
  assert.match(app, /NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้ ถ้าคิดว่าควรมีสิทธิ์ให้แจ้งผู้ดูแลระบบ"/);
  assert.match(app, /if \(document\.querySelector\("#repair-verify"\)\) return "request-verify";/);
  const help = read("modules/shortcut-help.js");
  for (const key of ["request-work", "request-verify", "request-viewer"]) assert.ok(help.includes(`"${key}": Object.freeze([`), key);
});
