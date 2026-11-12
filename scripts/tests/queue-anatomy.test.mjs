// คิวหน้าหลักและทางแนบไฟล์ (app.js): ทุกแถวบอกว่าต้องทำอะไร คิวที่มีแต่งานใช้เต็มจอ
// และหน้าที่ฟอร์มของขั้นมีช่องไฟล์ของตัวเองเหลือทางแนบทางเดียว
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const css = read("styles.css");
// ดึงฟังก์ชันระดับบนสุดของ app.js มารันแยก (ปิดด้วย "\n}" ที่ต้นบรรทัด)
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

test("codes in a queue title never break in the middle, and escaped entities are left alone", () => {
  const keep = load("keepCodesTogether");
  assert.equal(keep("ซีลยาง HS-08 รั่ว"), 'ซีลยาง <span class="nowrap">HS-08</span> รั่ว');
  assert.equal(keep("DR-15/2 และ LT-B2"), '<span class="nowrap">DR-15/2</span> และ <span class="nowrap">LT-B2</span>');
  for (const text of ["ปั๊มน้ำ &amp; วาล์ว", "it&#039;s", "&quot;A&quot;", "เครื่อง 12"]) assert.equal(keep(text), text);
  const long = "SEAL-RING-ASSEMBLY-0042-B";
  assert.equal(keep(`ชุด ${long}`), `ชุด ${long}`, "a code longer than a narrow column may still wrap, so it never hides under the title's overflow");
  assert.equal(keep("ABCDEFG-123456789"), "ABCDEFG-123456789", "17 characters wraps normally");
  assert.equal(keep("ABCDEFG-12345678"), '<span class="nowrap">ABCDEFG-12345678</span>', "16 characters stays together");
});

test("every queue row names its action: the step verb for approvals, the task for work done on the item's page", () => {
  const context = { window: {}, relation: (value) => value };
  vm.createContext(context);
  vm.runInContext(read("modules/step-verb.js"), context);
  const label = load("queueTaskLabel", {
    window: context.window,
    relation: (value) => value,
    requestModule: (code) => (code === "MANAGEMENT" ? { extraDecisions: [{ label: "รับทราบข้อมูล" }] } : null),
    myRepairActionLabels: { pending_assign: "มอบหมายช่าง" },
    statusLabels: { pending_verify: "รอผู้แจ้งตรวจรับ" },
  });
  const approval = (stepName, code = "MT_REPAIR") => ({ kind: "approval", step: { step_name: stepName }, request: { request_type: { code } } });
  assert.equal(label(approval("ผู้จัดการแผนกซ่อมบำรุงรับงาน")), "อนุมัติ", "no รับงาน chip: the MT head assigns, technicians cannot refuse");
  assert.equal(label(approval("ผู้จัดการแผนกที่รับผิดชอบรับทราบ")), "รับทราบ");
  assert.equal(label(approval("ผู้จัดการโรงงาน")), "อนุมัติ");
  assert.equal(label(approval("ผู้บริหารรับทราบ", "MANAGEMENT")), "อนุมัติ", "same word as the decision button when the module already has a รับทราบข้อมูล button");
  assert.equal(label({ kind: "repair", request: { status: "pending_assign" } }), "มอบหมายช่าง");
  assert.equal(label({ kind: "ncr", task: "ตอบ NCR", request: { status: "awaiting_response" } }), "ตอบ NCR");
});

test("the chip sits on the request-number line, approval chips have no arrow, and a task-only queue uses the full width", () => {
  const row = functionSource("homeQueueItemHtml");
  assert.match(row, /<span class="queue-item-top">[^\n]*<span class="queue-item-due">\$\{chip\}<span class="queue-item-age">\$\{escapeHtml\(age\)\}<\/span><\/span><\/span>/, "chip and age at the end of the number line, not beside the title");
  // ประเภทไม่พิมพ์ซ้ำในบรรทัดรอง (สีไอคอนและเลขที่บอกแล้ว) แต่ผู้อ่านหน้าจอยังได้ยิน
  assert.doesNotMatch(row, /const meta = \[type\?\.name_th/);
  assert.match(row, /<span class="sr-only">\$\{escapeHtml\(type\.name_th\)\}<\/span>/);
  assert.match(row, /queue-item-task\$\{item\.kind === "approval" \? " is-decide" : ""\}/);
  assert.match(app, /<div class="queue-layout\$\{approvalIds\.length \? "" : " is-tasks-only"\}">/);
  assert.match(app, /request_type: \{ code: "NCR_CAR", name_th: "NCR\/CAR" \}/, "the NCR row uses the module's one name");
  assert.match(css, /\.queue-item-main \{[^}]*grid-template-columns: 36px minmax\(0, 1fr\);/);
  assert.match(css, /\.queue-item-task\.is-decide::after \{ content: none; \}/);
  assert.match(css, /\.queue-layout\.is-tasks-only \.queue-detail-pane \{ display: none; \}/);
  assert.match(css, /\.queue-item-title \.nowrap \{ white-space: nowrap; \}/);
});

function fakeDom() {
  const created = [];
  const document = {
    createElement: (tag) => {
      const node = { tag, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } };
      created.push(node);
      return node;
    },
  };
  return { document, created };
}

test("a step form with its own file field replaces the separate uploader with a link to that field", () => {
  const { document, created } = fakeDom();
  const point = load("pointToStepFiles", { document, window: { matchMedia: () => ({ matches: true }) } });
  const standalone = { hidden: false, after(node) { this.next = node; } };
  const calls = [];
  const details = { setAttribute: (name) => calls.push(`open:${name}`) };
  const field = { scrollIntoView: (options) => calls.push(`scroll:${options.behavior}`) };
  const stepInput = { closest: (selector) => (selector === "details" ? details : field), focus: (options) => calls.push(`focus:${options.preventScroll}`) };
  assert.equal(point(standalone, stepInput, "แนบรูปใบเสร็จและไฟล์ในฟอร์มจบงาน"), true);
  assert.equal(standalone.hidden, true, "the separate uploader is hidden, so picked files cannot be left behind");
  assert.equal(created.length, 1);
  assert.equal(standalone.next, created[0]);
  assert.equal(created[0].textContent, "แนบรูปใบเสร็จและไฟล์ในฟอร์มจบงาน");
  assert.equal(created[0].type, "button");
  created[0].listeners.click();
  assert.deepEqual(calls, ["open:open", "scroll:auto", "focus:true"], "opens a folded form, scrolls to the field, focuses the picker");
});

test("pages without a step file field keep the separate uploader (approvers, viewers, signers)", () => {
  const { document, created } = fakeDom();
  const point = load("pointToStepFiles", { document, window: {} });
  const standalone = { hidden: false, after() { throw new Error("no link without a step field"); } };
  assert.equal(point(standalone, null, "x"), false);
  assert.equal(point(null, {}, "x"), false);
  assert.equal(standalone.hidden, false);
  assert.equal(created.length, 0);
  // ตัวที่เรียก: MT เฉพาะฟอร์มจบงาน · NCR เฉพาะฟอร์มของขั้นที่แนบหลักฐานได้ (เลือกด้วยชื่อการกระทำ ทดสอบใน ncr-detail-page.test.mjs)
  assert.match(app, /const stepFiles = document\.querySelector\("#finish-files"\) \?\? document\.querySelector\("#verify-files"\);\r?\n\s*pointToStepFiles\(document\.querySelector\("#attachment-form"\), stepFiles,/, "the finish form and the verify card each keep one way to attach");
  assert.match(read("modules/module-ncr.js"), /window\.pointToStepFiles\?\.\(document\.querySelector\("\.ncr-attach-form"\), stepFileInput\(document\.querySelectorAll\("\.ncr-actions form\.ncr-action"\)\),/);
});

test("no approval step in the harness reads รับงาน: MT goes factory manager → general manager, then the MT head assigns", () => {
  const mock = read("scripts/pilot-harness-mock.mjs");
  const stepNames = [...mock.matchAll(/\[\["([^"]+)", [^\]]+\](?:, \["([^"]+)", [^\]]+\])?\]/g)].flatMap((match) => [match[1], match[2]]).filter(Boolean);
  assert.ok(stepNames.includes("ผู้จัดการทั่วไป"), "the step lists were found");
  assert.deepEqual(stepNames.filter((name) => name.includes("รับงาน")), []);
  assert.match(mock, /MT_REPAIR: \[\["ผู้จัดการทั่วไป", ME_ID\]\],/, "a new harness MT request waits only for the general manager, then the MT head assigns");
});

test("the help legend explains the blue clock badge kept for NCR loss data", () => {
  const context = vm.createContext({});
  vm.runInContext(read("modules/shortcut-help.js"), context);
  const legend = context.MNP_SHORTCUT_HELP.BADGE_LEGEND.map(([name, label]) => [name, label]);
  assert.deepEqual(legend.find(([name]) => name === "loss-pending-flag"), ["loss-pending-flag", "NCR รอข้อมูลการสูญเสีย"]);
});
