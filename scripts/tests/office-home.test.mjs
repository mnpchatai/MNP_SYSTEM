import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// งานของระบบสำนักงาน (ใบสั่งงาน IT / ใบแจ้งซ่อม IT) บนหน้าแรก "งานของคุณวันนี้" — กติกากลางที่ modules/office-home.js
// ใช้ model จริงของทั้งสองโมดูล (กติกานับเดียวกับแท็บ/การ์ด) ส่วนการต่อ RPC ของแต่ละโมดูลทดสอบที่ itwo-module.test.mjs / itrp-module.test.mjs
const require = createRequire(import.meta.url);
await import("../../modules/office-home.js");
const rules = globalThis.MNP_OFFICE_HOME_RULES;
const itwo = require("../../modules/itwo-model.js");
const itrp = require("../../modules/itrp-model.js");

const ROLE_EMP = { is_dept_approver: false, is_it_admin: false, is_it_approver: false };
const ROLE_DEPT = { ...ROLE_EMP, is_dept_approver: true };
const ROLE_IT_ADMIN = { ...ROLE_EMP, is_it_admin: true };
const ROLE_VIEWER = { ...ROLE_EMP, is_it_viewer: true };

const SOURCES = {
  itwo: { model: itwo, source: { code: "IT_WORK_ORDER", typeName: "ใบสั่งงาน IT", urlOf: (id) => itwo.workOrderUrl("order", { id }), titleOf: (row) => row.details } },
  itrp: { model: itrp, source: { code: "IT_COMPUTER_REPAIR", typeName: "ใบแจ้งซ่อม IT", urlOf: (id) => itrp.repairUrl("order", { id }), titleOf: (row) => row.device_name } },
};
const row = (id, status, extra = {}) => ({ id: `id-${id}`, doc_no: `IT06-26/0${id}`, status, is_urgent: false, details: `งาน ${id}`, device_name: `เครื่อง ${id}`, created_at: `2026-11-2${id}T01:00:00Z`, rework_round: 0, rework_due_date: null, ...extra });
const build = (name, input) => rules.build({ ...SOURCES[name], approvals: [], it: [], mine: [], ...input });
const ids = (list) => list.map((item) => item.id);

for (const name of Object.keys(SOURCES)) {
  const { model } = SOURCES[name];

  test(`${name}: an approver gets the orders waiting on them, not the ones already asked back to the requester`, () => {
    const approvals = [row(1, "pending_dept", { requester_name: "สมหญิง", department_name: "การตลาด", is_urgent: true }), row(2, "need_info"), row(3, "pending_it_mgr")];
    const result = build(name, { role: ROLE_DEPT, approvals });
    assert.deepEqual(ids(result.tasks), ["id-1", "id-3"]);
    assert.equal(result.tasks[0].task, "รออนุมัติ");
    assert.equal(result.tasks[0].meta, "สมหญิง · การตลาด");
    assert.equal(result.tasks[0].urgent, true);
    assert.equal(result.tasks[0].typeName, SOURCES[name].source.typeName);
    assert.equal(result.tasks.length, model.waitingForMeCount(approvals), "same count as the approvals tab");
    assert.deepEqual(result.mine, []);
  });

  test(`${name}: a user with no approval right ignores approval rows; a read-only IT head has nothing to act on`, () => {
    const approvals = [row(1, "pending_dept")];
    assert.deepEqual(build(name, { role: ROLE_EMP, approvals }).tasks, []);
    // หัวหน้า IT (ดูอย่างเดียว) ได้รายการรออนุมัติจากฐานข้อมูลเฉพาะใบที่กดได้จริง · ไม่มีงาน IT ให้ลงมือ แม้ฐานข้อมูลส่งรายการงาน IT มา
    const viewer = build(name, { role: ROLE_VIEWER, approvals: [], it: [row(4, "approved"), row(5, "in_progress")] });
    assert.deepEqual(viewer.tasks, []);
  });

  test(`${name}: the IT admin gets exactly the work the tab/card counts (to start + in progress), not waiting-for-requester or finished work`, () => {
    const it = [
      row(1, "approved"),
      row(2, "pending_dept", { is_urgent: true }), // งานด่วน เริ่มก่อนอนุมัติครบได้
      row(3, "pending_dept"), // งานปกติที่ยังไม่อนุมัติ = ไม่ใช่งาน IT
      row(4, "in_progress"),
      row(5, "in_progress", { rework_round: 2, rework_due_date: "2026-12-01" }),
      row(6, "need_info"),
      row(7, "it_closed"),
      row(8, "received"),
      row(9, "cancelled"),
    ];
    const result = build(name, { role: ROLE_IT_ADMIN, it });
    assert.deepEqual(ids(result.tasks), ["id-1", "id-2", "id-4", "id-5"]);
    assert.deepEqual(result.tasks.map((task) => task.task), ["เริ่มงาน", "เริ่มงานก่อนอนุมัติ", "ส่งงาน", "แก้ไขงานครั้งที่ 2"]);
    assert.equal(result.tasks.length, model.itActionableCount(it), "same count as the IT tab / card");
    assert.equal(result.tasks[1].urgent, true);
    // ผู้ที่ไม่ใช่ผู้ดูแลงาน IT (เช่น ผู้อนุมัติขั้น IT) ไม่ได้งานจากรายการนี้
    assert.deepEqual(build(name, { role: { ...ROLE_EMP, is_it_approver: true }, it }).tasks, []);
  });

  test(`${name}: the requester gets the orders waiting for their answer or confirmation; their other open orders go to "mine" with a progress stage`, () => {
    const mine = [
      row(1, "need_info", { info_return_status: "pending_it_mgr", info_stage: "it_mgr" }),
      row(2, "it_closed"),
      row(3, "pending_dept", { is_urgent: true }),
      row(4, "in_progress", { rework_round: 1, rework_due_date: "2026-12-05" }),
      row(5, "received"),
      row(6, "rejected"),
      row(7, "cancelled"),
    ];
    const result = build(name, { role: ROLE_EMP, mine });
    assert.deepEqual(result.tasks.map((task) => [task.id, task.task]), [["id-1", "รอคุณตอบ"], ["id-2", "IT ส่งงานแล้ว รอคุณยืนยัน"]]);
    assert.equal(result.tasks.length, model.mineWaiting(mine).total, "same count as the 'รอคุณ' badge on the my-orders tab");
    assert.deepEqual(ids(result.mine), ["id-3", "id-4"], "finished orders and orders already in the queue are not repeated");
    assert.equal(result.mine[0].urgent, true);
    assert.equal(result.mine[0].progressStatus, "pending_dept");
    assert.equal(result.mine[0].label, "รอผู้จัดการแผนก");
    assert.equal(result.mine[1].label, "กำลังดำเนินการ · แก้ไขครั้งที่ 1 · กำหนด 05/12/2569");
    assert.equal(result.mine[0].href, SOURCES[name].source.urlOf("id-3"));
  });

  test(`${name}: an order is never listed twice (approval + IT work + own order) and an own order in the queue is not in "mine"`, () => {
    const same = row(1, "pending_it_mgr", { is_urgent: true });
    const result = build(name, { role: { ...ROLE_DEPT, is_it_admin: true }, approvals: [same], it: [same], mine: [same, row(2, "approved")] });
    assert.deepEqual(ids(result.tasks), ["id-1"]);
    assert.equal(result.tasks[0].task, "รออนุมัติ", "the approval comes first (it is the earlier step)");
    assert.deepEqual(ids(result.mine), ["id-2"]);
  });

  test(`${name}: every open status sits on a stage of the progress bar, and a question keeps the order on the stage it was asked at`, () => {
    for (const status of ["pending_dept", "pending_it_mgr", "approved", "in_progress", "it_closed", "received"]) {
      assert.ok(rules.PROGRESS_STAGES.some((stage) => stage.statuses.includes(status)), `${status} has a stage`);
    }
    assert.equal(rules.progressStatusOf(row(1, "need_info", { info_return_status: "pending_dept" })), "pending_dept");
    assert.equal(rules.progressStatusOf(row(1, "need_info", { info_stage: "it" })), "in_progress", "no return status: use the asker's stage");
    assert.equal(rules.progressStatusOf(row(1, "need_info", { info_stage: "dept" })), "pending_dept");
    assert.equal(rules.progressStatusOf(row(1, "need_info")), "need_info", "unknown stays as it is (the bar shows only the label)");
    assert.equal(rules.progressStatusOf(row(1, "approved")), "approved");
  });
}

test("the progress bar goes: report → department manager → IT approver → IT working → waiting to confirm → done", () => {
  assert.deepEqual(rules.PROGRESS_STAGES.map((stage) => stage.label), ["แจ้งงาน", "ผู้จัดการแผนก", "ผู้อนุมัติ IT", "IT ดำเนินการ", "รอยืนยัน", "จบงาน"]);
  assert.equal(Object.isFrozen(rules.PROGRESS_STAGES), true);
});

test("a task becomes a queue row the same shape as the NCR row, link only (kind office), urgent first", () => {
  const task = { id: "id-1", docNo: "IT06-26/080", typeCode: "IT_WORK_ORDER", typeName: "ใบสั่งงาน IT", title: "ออกแบบกล่อง", task: "รออนุมัติ", href: "#/office?module=work-order&view=order&id=id-1", urgent: true, createdAt: "2026-11-27T01:00:00Z", meta: "สมหญิง · การตลาด" };
  const item = rules.queueItem(task);
  assert.deepEqual({ ...item, request: { ...item.request, request_type: { ...item.request.request_type } } }, {
    kind: "office", id: "id-1", href: task.href, task: "รออนุมัติ", flag: "ด่วน", meta: "สมหญิง · การตลาด",
    request: { request_no: "IT06-26/080", title: "ออกแบบกล่อง", request_type: { code: "IT_WORK_ORDER", name_th: "ใบสั่งงาน IT" } },
    priority: "urgent", createdAt: "2026-11-27T01:00:00Z",
  });
  const normal = rules.queueItem({ ...task, urgent: false, meta: undefined });
  assert.equal(normal.flag, null);
  assert.equal(normal.priority, null);
  assert.equal(normal.meta, "");
});

test("a 'mine' row has the same look as a request row, escapes everything from the database, and passes the stages and Thai label to the progress bar", () => {
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const seen = [];
  const deps = {
    escapeHtml,
    requestTypeIcon: (code) => `<svg data-icon="${code}"></svg>`,
    requestPalette: () => "it",
    progressTracker: (status, repair, options) => { seen.push({ status, repair, options }); return `<div class="progress-cell">${escapeHtml(options.label)}</div>`; },
  };
  const evil = '<img src=x onerror="alert(1)">';
  const html = rules.mineRowHtml({ id: "id-1", at: "2026-11-27T01:00:00Z", docNo: evil, typeCode: "IT_WORK_ORDER", typeName: evil, title: evil, href: '#/office?x="><script>', urgent: true, progressStatus: "pending_dept", stages: rules.PROGRESS_STAGES, label: "รอผู้จัดการแผนก" }, deps);
  assert.doesNotMatch(html, /<img|<script/, "nothing from the database becomes markup");
  assert.match(html, /class="home-mine-row"/);
  assert.match(html, /urgent-flag">ด่วน</);
  assert.match(html, /data-icon="IT_WORK_ORDER"/);
  assert.deepEqual(seen, [{ status: "pending_dept", repair: false, options: { stages: rules.PROGRESS_STAGES, label: "รอผู้จัดการแผนก" } }]);
  assert.doesNotMatch(rules.mineRowHtml({ id: "x", docNo: "A", typeCode: "IT_WORK_ORDER", typeName: "B", title: "C", href: "#/o", urgent: false, progressStatus: "approved", stages: [], label: "x" }, deps), /urgent-flag/);
});

/* ---------- ทะเบียนโมดูลบนหน้าแรก ---------- */
const task = (id, extra = {}) => ({ id, docNo: id, typeCode: "X", typeName: "X", title: id, task: "t", href: `#/o?id=${id}`, urgent: false, createdAt: "2026-11-27T01:00:00Z", ...extra });
const mineRow = (id, extra = {}) => ({ id, at: "2026-11-27T01:00:00Z", docNo: id, typeCode: "X", typeName: "X", title: id, href: `#/o?id=${id}`, urgent: false, progressStatus: "approved", stages: [], label: "x", ...extra });

test("collect gathers every registered module in parallel, skips the departments that may not see it, and keeps the others when one fails", async () => {
  const called = [];
  const registry = {
    IT_WORK_ORDER: { label: "ใบสั่งงาน IT", load: async (employee) => { called.push(["IT_WORK_ORDER", employee.id]); return { tasks: [task("a")], mine: [mineRow("m1")] }; } },
    IT_COMPUTER_REPAIR: { label: "ใบแจ้งซ่อม IT", load: async () => { called.push(["IT_COMPUTER_REPAIR"]); throw new Error("rpc down"); } },
    FUTURE: { label: "โมดูลใหม่", load: async () => ({ tasks: [task("f")], mine: [] }) },
    BROKEN: { label: "ไม่มี load" },
  };
  const result = await rules.collect(registry, { id: "me" });
  assert.deepEqual(ids(result.tasks), ["a", "f"]);
  assert.deepEqual(ids(result.mine), ["m1"]);
  assert.deepEqual(result.failed, [{ code: "IT_COMPUTER_REPAIR", label: "ใบแจ้งซ่อม IT" }]);
  assert.deepEqual(called, [["IT_WORK_ORDER", "me"], ["IT_COMPUTER_REPAIR"]]);

  // แผนกที่จำกัดโมดูล (แผนก ID เห็นแค่ใบแจ้งซ่อม IT): โมดูลที่ไม่ได้สิทธิ์ไม่ถูกเรียกเลย
  called.length = 0;
  const restricted = await rules.collect(registry, { id: "me" }, { isAllowed: (code) => code === "IT_COMPUTER_REPAIR" });
  assert.deepEqual(called, [["IT_COMPUTER_REPAIR"]]);
  assert.deepEqual(restricted.tasks, []);
  assert.deepEqual(restricted.failed, [{ code: "IT_COMPUTER_REPAIR", label: "ใบแจ้งซ่อม IT" }]);
});

test("collect never rejects: no registry, empty result, or a module that never answers (timeout) leaves the rest of the home page alone", async () => {
  assert.deepEqual(await rules.collect(undefined, {}), { tasks: [], mine: [], failed: [] });
  assert.deepEqual(await rules.collect({}, {}), { tasks: [], mine: [], failed: [] });
  assert.deepEqual(await rules.collect({ A: { label: "A", load: async () => null } }, {}), { tasks: [], mine: [], failed: [] });
  const slow = { SLOW: { label: "ช้า", load: () => new Promise(() => {}) }, OK: { label: "ปกติ", load: async () => ({ tasks: [task("ok")], mine: [] }) } };
  const result = await rules.collect(slow, {}, { timeoutMs: 20 });
  assert.deepEqual(ids(result.tasks), ["ok"]);
  assert.deepEqual(result.failed, [{ code: "SLOW", label: "ช้า" }]);
  // ไม่มีตัวจับเวลาค้างหลังตอบเสร็จ (ไม่ทำให้โปรเซสไม่จบ)
  assert.equal(rules.LOAD_TIMEOUT_MS, 3000);
});

test("collect drops malformed rows: no id, or a link that is not an in-app route", async () => {
  const registry = { X: { label: "X", load: async () => ({
    tasks: [task("ok"), task("", { id: "" }), task("js", { href: "javascript:alert(1)" }), task("abs", { href: "https://evil.example/" }), { ...task("nohref"), href: undefined }, null],
    mine: [mineRow("ok2"), mineRow("js2", { href: "javascript:alert(1)" }), mineRow("", { id: undefined })],
  }) } };
  const result = await rules.collect(registry, {});
  assert.deepEqual(ids(result.tasks), ["ok"]);
  assert.deepEqual(ids(result.mine), ["ok2"]);
  assert.deepEqual(result.failed, []);
});

/* ---------- การต่อสายใน app.js / index.html (ตรวจจากซอร์ส เพราะ app.js ต้องมี DOM) ---------- */
const read = (file) => require("node:fs").readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the home page wires office work in: loader is isolated, tasks join the queue as link rows, mine rows are merged, the keyboard shortcuts skip them", () => {
  const app = read("app.js");
  assert.match(app, /function homeQueueItems\(pending, repairTasks, ncrTasks, officeTasks = \[\]\)/);
  assert.ok(app.includes("...officeTasks.map(window.MNP_OFFICE_HOME_RULES?.queueItem"));
  assert.ok(app.includes("rules.collect(window.MNP_OFFICE_HOME, employee, { isAllowed: deptModuleAllowed })"), "departments restricted to some modules (ID) do not load the others");
  // ทั้งหน้าหลักและแผง "งานถัดไป" (loadHomeQueueItems) นับงานชุดเดียวกัน
  assert.equal(app.match(/homeQueueItems\(pending, repairTasks, ncrItems\.tasks, officeItems\.tasks\)/g)?.length, 2);
  assert.ok(app.includes("officeItems.mine.map((row) => ({ at: row.at, html: window.MNP_OFFICE_HOME_RULES?.mineRowHtml?.("));
  // ลิงก์อย่างเดียว: แถว office ใช้แถวแบบ is-task ไม่มีปุ่มตัดสินใจ และคีย์ลัด A/R ข้ามแถว is-task
  assert.match(app, /item\.kind === "repair" \|\| item\.kind === "ncr" \|\| item\.kind === "office"/);
  assert.match(app, /if \(target instanceof HTMLElement && target\.closest\("\.queue-item\.is-task"\)\) return;/);
  // โมดูลสำนักงานล้ม: บอกผู้ใช้ แต่ไม่ throw (loadOfficeHome ไม่มี catch ภายนอกเพราะ collect ไม่ throw)
  assert.match(app, /if \(officeItems\.failed\.length\) showToast\(/);
});

test("index.html loads office-home.js before app.js with the same cache token as every other script", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script defer src="\.\/([^"?]+)\?v=([^"]+)"/g)].map((match) => ({ file: match[1], token: match[2] }));
  const position = (file) => scripts.findIndex((script) => script.file === file);
  assert.ok(position("modules/office-home.js") >= 0, "office-home.js is loaded");
  assert.ok(position("modules/office-home.js") < position("app.js"), "before app.js");
  assert.equal(new Set(scripts.map((script) => script.token)).size, 1, "one token for every script");
  assert.equal(scripts[0].token, "20261127labour1");
});

test("each office module announces its home work under the same code as its card, and the department rule keeps the work-order module away from department ID", () => {
  const registered = { "modules/module-itwo.js": "IT_WORK_ORDER", "modules/module-itrp.js": "IT_COMPUTER_REPAIR" };
  for (const [file, code] of Object.entries(registered)) {
    const source = read(file);
    assert.ok(source.includes(`(window.MNP_OFFICE_HOME ??= {}).${code} = { label: `), `${file} registers its home work`);
    assert.ok(source.includes(", load: loadHome };"), `${file} uses its loadHome`);
    assert.ok(source.includes(`(window.MNP_OFFICE_CARDS ??= {}).${code} = api`), "same key as the card");
  }
  const access = require("../../modules/department-access.js");
  const idDept = { department: { code: "ID" } };
  assert.equal(access.moduleAllowed(idDept, "IT_WORK_ORDER"), false);
  assert.equal(access.moduleAllowed(idDept, "IT_COMPUTER_REPAIR"), true);
});

test("if office-home.js fails to load, the home page and the next-item panel skip office work instead of throwing", () => {
  const app = read("app.js");
  // loader: ไม่มี collect = ผลว่างทันที (ไม่เรียก property ของ undefined)
  assert.ok(app.includes('if (typeof rules?.collect !== "function") return { tasks: [], mine: [], failed: [] };'));
  assert.ok(app.includes("window.MNP_OFFICE_HOME_RULES?.queueItem ?? (() => null)).filter(Boolean)"));
  assert.ok(app.includes('window.MNP_OFFICE_HOME_RULES?.mineRowHtml?.(row, { escapeHtml, requestTypeIcon, requestPalette, progressTracker }) ?? ""'));
  assert.ok(!app.includes("window.MNP_OFFICE_HOME_RULES.queueItem") && !app.includes("window.MNP_OFFICE_HOME_RULES.collect") && !app.includes("window.MNP_OFFICE_HOME_RULES.mineRowHtml"), "every use is guarded");
  // รันตัวเลือกจริงของ loadOfficeHome ใน context ที่ไม่มี RULES
  const start = app.indexOf("async function loadOfficeHome(employee) {") + "async function loadOfficeHome(employee) {".length;
  const body = app.slice(start, app.indexOf(String.fromCharCode(10) + "}", start));
  assert.ok(body, "loadOfficeHome found");
  const run = new Function("window", "deptModuleAllowed", "employee", `return (async () => {${body}})();`);
  return Promise.all([
    run({}, () => true, {}).then((result) => assert.deepEqual(result, { tasks: [], mine: [], failed: [] })),
    run({ MNP_OFFICE_HOME_RULES: {} }, () => true, {}).then((result) => assert.deepEqual(result, { tasks: [], mine: [], failed: [] })),
  ]);
});
