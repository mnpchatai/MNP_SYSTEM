// PR 1 ของรอบ 36/40: แผงตัดสินใจ รายละเอียดคำร้อง และคำอธิบายตามต้องการ
// - คำกริยาของขั้นบนหน้าจอ (รับทราบ/อนุมัติ · ไม่มีรับงาน) ค่าที่เก็บยัง "approved"
// - confirmDialog รับ cancelLabel · ตารางคีย์ลัด · A/R ใช้ได้ในหน้ารายละเอียด · ชื่อ nav ที่ 1024px
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

await import("../../modules/step-verb.js");
await import("../../modules/shortcut-help.js");
const verbs = globalThis.MNP_STEP_VERB;
const help = globalThis.MNP_SHORTCUT_HELP;

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = read("app.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const mt = read("modules/module-mt.js");

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ดึงฟังก์ชันระดับบนสุดจาก app.js (จากหัวฟังก์ชันถึง "}" บรรทัดแรกที่ชิดซ้าย)
function extract(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} found in app.js`);
  const end = app.indexOf("\n}\n", start) + 2;
  return app.slice(start, end);
}

function load(names, context = {}) {
  const sandbox = vm.createContext({ escapeHtml, window: { MNP_STEP_VERB: verbs }, ...context });
  vm.runInContext(`${names.map(extract).join("\n")}\nthis.api = { ${names.join(", ")} };`, sandbox);
  return sandbox.api;
}

test("the step verb comes from the step name, with approve as the default", () => {
  // ไม่มีขั้นรับงาน: หัวหน้าซ่อมบำรุงมอบหมายช่างหลังผู้จัดการทั่วไปอนุมัติ ช่างปฏิเสธงานไม่ได้ (กติกาผู้ใช้)
  assert.equal(verbs.verbOf("ผู้จัดการแผนกซ่อมบำรุงรับงาน"), "อนุมัติ", "no step ever reads รับงาน");
  assert.ok(!verbs.STEP_VERBS.includes("รับงาน"));
  assert.equal(verbs.verbOf("ผู้จัดการแผนกที่รับผิดชอบรับทราบ"), "รับทราบ");
  assert.equal(verbs.verbOf("ผู้จัดการโรงงานอนุมัติ"), "อนุมัติ");
  assert.equal(verbs.verbOf("ผู้จัดการโรงงาน"), "อนุมัติ", "a plain role name is an ordinary approval step");
  assert.equal(verbs.verbOf("ผู้จัดการโรงงานตรวจสอบ"), "อนุมัติ");
  assert.equal(verbs.verbOf(undefined), "อนุมัติ");
  assert.equal(verbs.verbOf("ผู้จัดการแผนกรับทราบ", ["รับทราบข้อมูล"]), "อนุมัติ", "no second button that reads the same as the module's own acknowledge");
  assert.equal(verbs.pendingLabel("ผู้จัดการแผนกที่รับผิดชอบรับทราบ"), "รอรับทราบ");
  assert.equal(verbs.pendingLabel("ผู้จัดการแผนกซ่อมบำรุงรับงาน"), "รออนุมัติ");
  assert.equal(verbs.pendingLabel("ผู้จัดการโรงงาน"), "รออนุมัติ");
});

test("the step line names the real next step instead of 'final step' when the workflow continues", () => {
  const base = { currentStepName: "ผู้จัดการโรงงาน" };
  assert.equal(verbs.stepLineText({ ...base, nextStepName: "ผู้จัดการทั่วไป" }), "ขั้นตอน: ผู้จัดการโรงงาน · ถัดไป: ผู้จัดการทั่วไป");
  assert.equal(verbs.stepLineText({ ...base, afterLast: verbs.afterLastStep({ repair: true }) }), "ขั้นตอน: ผู้จัดการโรงงาน · ถัดไป: มอบหมายช่าง");
  assert.equal(verbs.stepLineText({ ...base, afterLast: verbs.afterLastStep({ repair: false }) }), "ขั้นตอน: ผู้จัดการโรงงาน · ถัดไป: ดำเนินงาน");
  assert.equal(verbs.stepLineText({ ...base, afterLast: verbs.afterLastStep({ endsAtDecision: true }) }), "ขั้นตอน: ผู้จัดการโรงงาน · ขั้นสุดท้าย", "a request that ends at the decision really is final");
  assert.equal(verbs.stepLineText({ ...base, nextStepKnown: false }), "ขั้นตอน: ผู้จัดการโรงงาน", "unknown order: say nothing about what comes next");
});

test("the decision buttons wear the step verb but still send 'approved'", () => {
  const { decisionButtonsOf } = load(["decisionButtonsOf"]);
  const buttons = [...decisionButtonsOf([], "ผู้จัดการแผนกที่รับผิดชอบรับทราบ")];
  assert.deepEqual(buttons.map((item) => item.decision), ["rejected", "more_info", "approved"], "stored decisions are unchanged");
  assert.equal(buttons.at(-1).label, "รับทราบ");
  assert.equal(decisionButtonsOf([], "ผู้จัดการแผนกซ่อมบำรุงรับงาน").at(-1).label, "อนุมัติ", "never a รับงาน button");
  assert.equal(buttons.at(-1).tone, "success");
  assert.equal(decisionButtonsOf([], "").at(-1).label, "อนุมัติ");
  const withAck = [...decisionButtonsOf([{ decision: "acknowledged", label: "รับทราบข้อมูล" }], "ผู้จัดการแผนกรับทราบ")];
  assert.deepEqual(withAck.map((item) => item.label), ["ไม่อนุมัติ", "ขอข้อมูลเพิ่ม", "รับทราบข้อมูล", "อนุมัติ"]);
  // RPC payload and the receipt/line text all read the same label list
  assert.match(app, /sb\.rpc\("app_approval_decision", \{ p_step_id: currentStep\.id, p_decision: decision, p_comment: text \}\)/);
  assert.match(app, /const options = decisionButtonsOf\(extraDecisions, currentStep\.step_name\);/);
  assert.match(app, /button\(`ยืนยัน\$\{labelOf\(decision\)\}`/);
  assert.match(app, /recentDecisions\.set\(id, \{ decision, label: labelOf\(decision\),/);
  assert.match(app, /const verb = receipt\.label \?\? decisionVerbs\[receipt\.decision\]/);
});

test("the panel head shows the repair hand-off and the message for 'ask for more info' names who it goes back to", () => {
  const api = load(["decisionPanelHtml", "idleDecisionButtonsHtml", "decisionButtonsOf"], {
    relation: (value) => value,
    isRepairType: (type) => type?.code === "MT_REPAIR",
    requestModule: () => null,
    extraFilesFieldHtml: () => "",
  });
  const html = api.decisionPanelHtml({
    request: { request_no: "MT-1", title: "เครื่องเสีย", request_type: { code: "MT_REPAIR" } },
    currentStep: { step_name: "ผู้จัดการโรงงาน" }, nextStep: null, extraDecisions: [],
  });
  assert.match(html, /ขั้นตอน: ผู้จัดการโรงงาน · ถัดไป: มอบหมายช่าง/);
  assert.doesNotMatch(html, /ขั้นสุดท้าย/);
  assert.match(app, /decision === "more_info" \? ` → ส่งกลับให้ \$\{requesterName \|\| "ผู้แจ้ง"\}`/);
  assert.match(app, /requesterName: personName\(directory, request\.requester_id\)/, "detail page passes the requester");
  assert.match(app, /requesterName: personName\(ctx\.directory, item\.request\.requester_id\)/, "queue passes the requester");
});

test("the status badge and the MT badge say what the current step asks for", () => {
  const api = load(["statusBadge", "pendingStepBadge"], { statusLabel: (status) => (status === "pending_approval" ? "รออนุมัติ" : status) });
  assert.match(api.pendingStepBadge({ status: "pending_approval" }, { step_name: "ผู้จัดการแผนกที่รับผิดชอบรับทราบ" }), /รอรับทราบ/);
  assert.match(api.pendingStepBadge({ status: "pending_approval" }, { step_name: "ผู้จัดการแผนกซ่อมบำรุงรับงาน" }), /รออนุมัติ/, "never รอรับงาน");
  assert.match(api.pendingStepBadge({ status: "pending_approval" }, null), /รออนุมัติ/, "no current step: the plain label");
  assert.match(api.pendingStepBadge({ status: "approved" }, { step_name: "รับงาน" }), />approved</, "other statuses are untouched");
  assert.match(mt, /window\.MNP_STEP_VERB\.pendingLabel\(stepName\)/);
  // ชื่อขั้นในป้ายซ่อนได้ (.badge-step) เมื่อแถบตัดสินใจบอกชื่อขั้นอยู่แล้ว: บอกครั้งเดียว
  assert.match(mt, /<span class="badge-step">/);
  assert.match(readFileSync(new URL("../../styles.css", import.meta.url), "utf8"), /\.has-step-line \.badge-step \{ display: none; \}/);
  assert.match(readFileSync(new URL("../../app.js", import.meta.url), "utf8"), /request-detail-head\$\{moduleHead \? " request-module-header" : ""\}\$\{canApprove \? " has-step-line" : ""\}/);
});

test("confirmDialog takes a cancel label and keeps 'ยกเลิก' by default", () => {
  const { confirmDialog } = load(["confirmDialog"], {
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    document: {
      body: { append() {} },
      createElement() {
        const node = { open: false, setAttribute() {}, addEventListener() {}, close() {}, remove() {}, showModal() {}, querySelector: () => ({ addEventListener() {}, focus() {} }) };
        let html = "";
        Object.defineProperty(node, "innerHTML", { get: () => html, set: (value) => { html = value; globalThis.__lastDialog = value; } });
        return node;
      },
    },
  });
  confirmDialog({ title: "ยืนยันยกเลิก NCR-1?", confirmLabel: "ยกเลิก NCR", cancelLabel: "ไม่ยกเลิก", danger: true });
  assert.match(globalThis.__lastDialog, /<button class="btn secondary" value="cancel">ไม่ยกเลิก<\/button><button class="btn danger-solid" value="confirm">ยกเลิก NCR<\/button>/);
  confirmDialog({ title: "ลบ?", confirmLabel: "ลบ" });
  assert.match(globalThis.__lastDialog, /value="cancel">ยกเลิก<\/button>/, "default label unchanged");
  confirmDialog({ title: "x", confirmLabel: "ok", cancelLabel: "<b>" });
  assert.match(globalThis.__lastDialog, /value="cancel">&lt;b&gt;<\/button>/, "the label is escaped");
  delete globalThis.__lastDialog;
  // ที่ที่ปุ่มยืนยันขึ้นต้นด้วย "ยกเลิก"
  assert.match(read("modules/module-ncr.js"), /confirmLabel: "ยกเลิก NCR", cancelLabel: "ไม่ยกเลิก"/);
  assert.match(read("modules/module-qc.js"), /confirmLabel: "ยกเลิกใบตรวจ", cancelLabel: "ไม่ยกเลิก"/);
  assert.match(read("modules/rubberflow-ui.js"), /\/\^ยกเลิก\/\.test\(label\) \? \{ cancelLabel: "ไม่ยกเลิก" \}/);
  assert.match(app, /confirmLabel: "ทิ้งใบนี้", cancelLabel: "กลับไปกรอกต่อ"/);
});

test("confirm and send-now are guarded against the double tap, and the guard re-arms in each state", () => {
  assert.match(app, /const tapGuard = rules\.createTapGuard\(\);/);
  assert.match(app, /if \(\(action === "confirm" \|\| action === "send-now"\) && tapGuard\.blocks\(event\)\) return;/);
  assert.match(app, /if \(state\.name === "compose"\) \{\n\s+tapGuard\.arm\(\);/);
  assert.match(app, /if \(state\.name === "pending"\) \{\n\s+tapGuard\.arm\(\);/);
});

test("the MT assign dates use the shared Thai date picker and are still required", () => {
  assert.match(mt, /assignForm\.querySelectorAll\('input\[type="date"\]'\)\.forEach\(\(input\) => \{\n\s+input\.required = false;\n\s+window\.MNP_DATE_PICKER\.enhance\(input\);/);
  // ยังบังคับกรอก แต่บอกใต้ช่องเป็นภาษาไทย (MNP_FORM_STEPS) แทน bubble ของเบราว์เซอร์และ toast
  assert.match(mt, /\{ name: "work_started_date", required: true, message: "เลือกวันเริ่มงาน" \}/);
  assert.match(mt, /\{ name: "work_expected_date", required: true, message: "เลือกวันที่คาดว่าจะเสร็จ", check: /);
  assert.match(mt, /<form id="assign-form" novalidate>/);
  assert.match(mt, /<form id="finish-form" novalidate>/);
  assert.match(mt, /\{ name: "cause_analysis", required: true, minLength: 3, /);
});

test("after the assignment, editing it is folded at the end of the MT page instead of sitting above the task", () => {
  assert.match(mt, /\$\{canAssign && request\.status === "pending_assign" \? assignSection : ""\}/);
  assert.match(mt, /\$\{canAssign && request\.status !== "pending_assign" \? assignSection : ""\}\n\s+\$\{canVerify \?/);
  assert.match(mt, /<details class="card detail-section repair-assign-edit" id="repair-assign"><summary><h2>แก้ไขการมอบหมายช่าง<\/h2><\/summary>/);
  for (const name of ["technician_ids", "execution_plan", "inspector_opinion", "work_started_date", "work_expected_date", "cause_analysis"]) assert.match(mt, new RegExp(`data-field="${name}"`));
});

test("the shortcut legend lists the real shortcuts and opens with ? on Latin and Thai keyboards", () => {
  const html = help.legendHtml(escapeHtml);
  for (const key of ["/", "J", "K", "A", "R", "Esc", "?"]) assert.match(html, new RegExp(`<kbd>${key.replace("/", "\\/").replace("?", "\\?")}</kbd>`), `${key} listed`);
  assert.match(help.legendHtml((value) => `[${value}]`), /\[\?\]/, "every value goes through the escape function");
  assert.equal(help.isHelpKey({ key: "?", code: "Slash", shiftKey: true }), true);
  assert.equal(help.isHelpKey({ key: "ฦ", code: "Slash", shiftKey: true }), true, "Thai layout, same physical key");
  assert.equal(help.isHelpKey({ key: "?", shiftKey: true, ctrlKey: true }), false);
  assert.equal(help.isHelpKey({ key: "/", code: "Slash", shiftKey: false }), false, "plain / is the search shortcut");
  assert.equal(help.isHelpKey({ key: "a", code: "KeyA" }), false);
  // wiring: key handler, top-bar button, no typing/dialog conflicts
  assert.match(app, /window\.MNP_SHORTCUT_HELP\.isHelpKey\(event\)/);
  assert.match(app, /class="icon-button help-toggle" type="button" aria-label="ช่วยเหลือ" title="ช่วยเหลือ \(กด \?\)"/);
  assert.match(app, /\$\{helpButton\(\)\}\$\{themeButton\(\)\}/);
  assert.match(app, /querySelector\("\.help-toggle"\)\?\.addEventListener\("click", openShortcutHelp\)/);
  const opener = app.slice(app.indexOf("function openShortcutHelp("), app.indexOf("document.addEventListener", app.indexOf("function openShortcutHelp(")));
  assert.match(opener, /opener\.focus\(\)/, "focus returns to the opener");
  assert.match(opener, /dialog\.showModal\(\)/);
  // ปุ่มแสดงทุกอุปกรณ์ จอสัมผัสล้วนซ่อนเฉพาะส่วนคีย์ลัดในกล่อง
  assert.doesNotMatch(css, /\.help-toggle \{ display: none; \}/);
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{ \.help-keys \{ display: none; \} \}/);
  assert.match(opener, /window\.MNP_SHORTCUT_HELP\.helpHtml\(escapeHtml, helpPageKey\(currentRoute\(\)\)\)/);
  assert.match(app, /if \(route\.path === "requests" && route\.params\.get\("mode"\) === "create"\) return "new";/, "the create form gets the create-page tips");
  assert.match(app, /if \(route\.path === "ncr"\) return route\.params\.get\("id"\) \? "ncr" : "";/, "NCR tips only on an NCR record");
  // every listed letter shortcut exists in the key handlers
  assert.match(app, /KeyJ: "j", KeyK: "k", KeyA: "a", KeyR: "r"/);
});

test("the help sheet explains the page, every badge glyph and (on keyboard devices) the shortcuts", () => {
  const html = help.helpHtml(escapeHtml, "request");
  assert.match(html, /<h3>หน้านี้<\/h3>/);
  assert.match(html, /คำของขั้น/);
  assert.match(html, /<section class="help-section help-keys"><h3>คีย์ลัด<\/h3><dl class="shortcut-list">/);
  for (const [name] of help.BADGE_LEGEND) assert.match(html, new RegExp(`<span class="badge ${name}">`), `${name} in the legend`);
  assert.doesNotMatch(help.helpHtml(escapeHtml, "unknown-page"), /<h3>หน้านี้<\/h3>/, "pages without tips show only the legend and shortcuts");
  // คำแนะนำต่อหน้าใช้ path ที่มีอยู่จริงใน router
  // path ของหน้าหลักอยู่ใน router ของ app.js ส่วนแดชบอร์ด RubberFlow และ BOM เป็น PATH ของโมดูล
  const modulePaths = new Set(["module-mt-dashboard.js", "module-ncr-dashboard.js", "module-rubberflow.js", "module-bom.js"].map((file) => readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8").match(/const PATH = "([^"]+)"/)?.[1]));
  for (const path of Object.keys(help.PAGE_HELP)) assert.ok(new RegExp(`path === "${path}"`).test(app) || modulePaths.has(path), `route ${path} exists`);
  assert.match(help.helpHtml((value) => `[${value}]`, "dashboard"), /<li>\[/, "tips go through the escape function");
});

test("A and R also work on the request detail page, J and K only in the queue", () => {
  const handler = app.slice(app.indexOf("const inQueue = Boolean"), app.indexOf("button.click();", app.indexOf("const inQueue = Boolean")));
  assert.match(handler, /!\(inQueue \|\| document\.querySelector\("#decision-panel"\)\)/);
  assert.match(handler, /if \(key === "j" \|\| key === "k"\) \{\n\s+if \(!inQueue\) return;/);
  assert.match(handler, /panel\.dataset\.state !== "idle"/, "only from the idle state, like the queue");
  assert.match(handler, /event\.code\] \?\? event\.key\.toLowerCase\(\)/, "Thai-layout fix is the shared one");
});

test("icon-only navigation links carry a title, and the step line stays visible on narrow screens", () => {
  assert.match(app, /aria-label="\$\{escapeHtml\(label\)\}" title="\$\{escapeHtml\(label\)\}"/);
  assert.doesNotMatch(css, /\.action-panel \.action-panel-head \{ display: none; \}\s*\n\s*\.queue-item/, "the narrow-screen rule keeps the head for the decision panel");
  assert.match(css, /\.decision-panel \.action-panel-head \{ display: block; \}\s*\.decision-panel \.action-panel-head h2 \{ display: none; \}/);
  assert.match(css, /\.decision-panel:not\(\[data-state="idle"\]\) \.action-panel-head \{ display: none; \}/, "no duplicate next step while confirming");
});
