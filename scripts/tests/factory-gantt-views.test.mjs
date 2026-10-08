import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดหน้าจอตารางการผลิต (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
// ตรวจ HTML ที่วาด (กรอบออเดอร์ แถบ คำเตือน ช่องแก้ที่โผล่ตามสิทธิ์) การเรียก RPC จากปุ่ม และข้อความผิดพลาด (ไม่มี DOM จริง)
const FILES = [
  "modules/factory-departments.js",
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/factory-gantt-model.js",
  "modules/module-factory-master.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
  "modules/module-factory-gantt.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";
// วันนี้ในเทสต์คือจันทร์ 2026-10-12 (เวลาไทย)
class FakeDate extends Date { static now() { return Date.UTC(2026, 9, 12, 3, 0); } }

const center = (code, extra = {}) => ({ id: `w-${code}`, code, name: `ศูนย์ ${code}`, department_code: code, shift_start: "08:00", shift_end: "17:00", break_minutes: 60, working_days: [1, 2, 3, 4, 5], units: 1, efficiency_percent: 100, calendar_version: 3, updated_at: null, updated_by_name: null, ...extra });
const step = (sequence, centerCode, setup, run, status = "pending") => ({ sequence, name: `ขั้น ${sequence}`, work_center_code: centerCode, setup_minutes: setup, run_minutes: run, status });
const job = (id, code, extra = {}) => ({ id, code, status: "open", version: 1, schedule_version: 1, production_order_id: "o1", item_id: `i-${id}`, item_code: `ITEM-${code}`, item_name: `ชื่อ ${code}`, unit_code: "KG",
  qty: 100, output_qty: null, bom_output_qty: 100, planned_start: null, planned_end: null, started_at: null, completed_at: null, scheduled_at: null, scheduled_by_name: null, needs: [], steps: [step(10, "RB", 10, 100)], ...extra });
const FIXTURE = {
  can_edit: true,
  work_centers: [center("RB"), center("GR", { units: 2, efficiency_percent: 50, updated_at: "2026-10-10T01:00:00Z", updated_by_name: "ทดสอบ พนักงานวางแผน" })],
  orders: [
    { id: "o1", code: "TEST-MO-26-001", status: "released", customer: `ลูกค้า ${XSS}`, due_date: "2026-10-16", work_order_no: "WO-1", item_code: "FG-1", item_name: "สินค้า", unit_code: "SET", planned_qty: 12, completed_qty: 0 },
    { id: "o2", code: "TEST-MO-26-002", status: "released", customer: "ลูกค้า ข", due_date: "2026-11-30", work_order_no: "WO-2", item_code: "FG-2", item_name: "สินค้า 2", unit_code: "SET", planned_qty: 5, completed_qty: 0 },
  ],
  jobs: [
    // RB: 1,500 นาทีใน 3 วันทำงาน (จ-พ) = 500/วัน เกินกำลัง 480
    job("j-rubber", "TEST-JB-26-001", { planned_start: "2026-10-12", planned_end: "2026-10-14", steps: [step(10, "RB", 10, 10, "done"), step(20, "RB", 0, 1500)] }),
    // เริ่ม 10-13 ก่อนยางเส้นยาวจบ (10-14) และจบ 10-17 เกินกำหนดส่ง 10-16
    job("j-part", "TEST-JB-26-002", { status: "in_progress", needs: ["j-rubber"], planned_start: "2026-10-13", planned_end: "2026-10-17", steps: [step(10, "GR", 0, 60)] }),
    job("j-none", "TEST-JB-26-003"),
    job("j-other", "TEST-JB-26-004", { production_order_id: "o2", planned_start: "2026-10-19", planned_end: "2026-10-21", schedule_version: 4 }),
    job("j-done", "TEST-JB-26-005", { production_order_id: "o2", status: "completed", planned_start: "2026-10-12", planned_end: "2026-10-12", steps: [step(10, "RB", 0, 10, "done")] }),
  ],
};

function loadFactory({ data = FIXTURE, rpc } = {}) {
  const calls = [];
  const toasts = [];
  const log = { calls, toasts, renders: 0 };
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: (message, kind) => toasts.push([message, kind ?? "ok"]),
    friendlyError: (error) => context.MNP_FACTORY_ERRORS[Object.keys(context.MNP_FACTORY_ERRORS).find((key) => String(error?.message ?? error).includes(key))] ?? String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; },
    Intl, Date: FakeDate, URLSearchParams,
    FormData: class { constructor(form) { this.values = form.__values ?? {}; } get(key) { return [].concat(this.values[key] ?? [])[0] ?? null; } getAll(key) { return [].concat(this.values[key] ?? []); } },
    sb: { rpc: async (name, args) => { calls.push([name, args]); return rpc ? rpc(name, args) : { data: name === "app_factory_schedule_data" ? data : { ok: true }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

// root จำลองที่ view ผูก event: rows = แถวในตารางเวลา (data-gt-row) forms = ฟอร์มปฏิทิน (form[data-gt-calendar])
async function render(view, { rows = [], forms = [], ...options } = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const root = { querySelectorAll: (selector) => (selector === "[data-gt-row]" ? rows : selector === "form[data-gt-calendar]" ? forms : []) };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS[view]({ params: new URLSearchParams(""), frame });
  return { ...painted, log, context, root };
}
const element = (extra = {}) => ({ handlers: {}, dataset: {}, hidden: false, disabled: false, textContent: "", addEventListener(type, handler) { this.handlers[type] = handler; }, ...extra });
function fakeRow(id, version, start, end) {
  const inputs = { start: element({ value: start }), end: element({ value: end }) };
  const save = element();
  const nudges = [element({ dataset: { gtNudge: "-1" } }), element({ dataset: { gtNudge: "1" } })];
  return { dataset: { gtJob: id, gtVersion: String(version) }, inputs, save, nudges,
    querySelector: (selector) => (selector.includes('"start"') ? inputs.start : selector.includes('"end"') ? inputs.end : selector === "[data-gt-save]" ? save : null),
    querySelectorAll: (selector) => (selector === "[data-gt-nudge]" ? nudges : []) };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every error code the schedule migration can raise has a Thai message that is not hidden by another key", () => {
  const sql = fs.readFileSync("supabase/migrations/20261008010000_factory_gantt_schedule.sql", "utf8");
  const codes = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(codes.length >= 9, `found ${codes.length} codes`);
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  for (const code of codes) assert.ok(messages[code], `${code} has no message`);
  const keys = Object.keys(messages);
  for (const key of keys) assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
});

test("both views are registered and the schedule folder of the menu is drawable", () => {
  const { context } = loadFactory();
  for (const name of ["gantt", "gantt-calendar"]) assert.equal(typeof context.MNP_FACTORY_VIEWS[name], "function", name);
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "schedule");
  assert.deepEqual(plain(folder.entries.map((entry) => entry.view)), ["gantt", "gantt-calendar"]);
});

test("the chart draws each customer order as a frame with its jobs inside, bars placed by day", async () => {
  const { body, log } = await render("gantt");
  assert.deepEqual(plain(log.calls), [["app_factory_schedule_data", null]], "one read, no write");
  const rows = [...body.matchAll(/<div class="gantt-row gantt-(order|job)">/g)].map((match) => match[1]);
  assert.deepEqual(rows, ["order", "job", "job", "job", "order", "job", "job"], "MO-001 with 3 jobs, then MO-002 with 2 (the order with the earlier due date first)");
  assert.ok(body.indexOf("TEST-MO-26-001") < body.indexOf("TEST-JB-26-001") && body.indexOf("TEST-JB-26-003") < body.indexOf("TEST-MO-26-002"), "jobs sit between their own order and the next one");
  // ช่วงแผนภูมิ: วันนี้ 10-12 → เริ่ม 10-10 (เผื่อ 2 วัน) · ยางเส้นยาวเริ่ม 10-12 = ห่างจากวันแรก 2 วัน ยาว 3 วัน
  assert.match(body, /class="gantt-bar gantt-s-open"[^>]*style="--o:2;--n:3"/);
  assert.match(body, /class="gantt-bar gantt-s-in_progress is-late has-conflict"[^>]*style="--o:3;--n:5"/, "10-13 to 10-17: late and starts before the rubber job ends");
  assert.match(body, /class="gantt-bar gantt-s-open"[^>]*style="--o:9;--n:3"/, "the other order job starts on 10-19");
  assert.match(body, /class="gantt-bar gantt-s-completed"[^>]*style="--o:2;--n:1"/);
  assert.match(body, /<span class="gantt-fill" style="width:50%">/, "one of two steps is done");
  assert.match(body, /class="gantt-frame is-late" style="--o:2;--n:6"/, "the frame of MO-001 spans 10-12 to 10-17 and is late");
  assert.match(body, /class="gantt-frame" style="--o:2;--n:10"/, "MO-002 spans its finished job (10-12) to its last job (10-21) and is on time");
  assert.match(body, /class="gantt-due" style="--o:6"/, "due date 10-16");
  assert.match(body, /class="gantt-today" style="--o:2"/, "today is 10-12");
  assert.match(body, /gantt-unscheduled">ยังไม่กำหนดตาราง/);
  assert.match(body, /href="#\/factory\?item=job-view&amp;jb=j-rubber"/, "a bar opens the job");
  assert.match(body, /href="#\/factory\?item=production-view&amp;po=o1"/, "an order opens the production order");
});

test("text from the data is escaped everywhere on the page", async () => {
  const { body } = await render("gantt", { data: { ...FIXTURE, jobs: FIXTURE.jobs.map((row) => ({ ...row, item_name: XSS, item_code: XSS })) } });
  assert.ok(!body.includes("<script>"), "no raw script tag");
  assert.match(body, /ลูกค้า &lt;script&gt;/);
});

test("the capacity rows mark the overloaded days and the warnings explain every problem", async () => {
  const { body } = await render("gantt");
  assert.match(body, /gantt-capacity[\s\S]*?<strong>RB<\/strong>/);
  assert.equal([...body.matchAll(/gantt-cell level-over/g)].length, 3, "RB is over its 480 minutes on Monday, Tuesday and Wednesday");
  assert.match(body, /gantt-cell level-over"[^>]*>104</, "500 / 480");
  const gr = body.slice(body.indexOf("<strong>GR</strong>"));
  assert.match(gr, /gantt-cell level-ok"[^>]*>3</, "GR has 60 minutes over 5 days = 12 of 480 minutes per day, so it is fine");
  const warnings = text(body.slice(body.indexOf('class="gantt-warnings"'), body.indexOf("ตารางเวลาของใบงาน")));
  assert.match(warnings, /TEST-JB-26-002 สิ้นสุด d\(2026-10-17\) เกินกำหนดส่ง d\(2026-10-16\)/);
  assert.match(warnings, /TEST-JB-26-002 เริ่ม d\(2026-10-13\) ก่อน TEST-JB-26-001 .* สิ้นสุด d\(2026-10-14\)/);
  assert.match(warnings, /ศูนย์งาน RB เกินกำลัง 3 วัน \(สูงสุด 104%/);
  assert.match(warnings, /มี 1 ใบงานที่ยังไม่กำหนดตาราง/);
  const calm = await render("gantt", { data: { ...FIXTURE, jobs: [job("j-ok", "TEST-JB-26-009", { planned_start: "2026-10-12", planned_end: "2026-10-13" })], orders: [FIXTURE.orders[0]] } });
  assert.match(calm.body, /ไม่มีคำเตือน/);
});

test("the summary tiles count orders, unscheduled jobs, late jobs and overloaded days", async () => {
  const { body } = await render("gantt");
  const tiles = text(body.slice(0, body.indexOf("ตารางการผลิตตามออเดอร์")));
  assert.match(tiles, /ออเดอร์ที่มีใบงาน 2 ใบงานที่ยังไม่จบ 4 ใบ/);
  assert.match(tiles, /ยังไม่กำหนดตาราง 1/);
  assert.match(tiles, /เกินกำหนดส่ง 1/);
  assert.match(tiles, /วันที่เกินกำลังศูนย์งาน 3/);
});

test("someone who may edit gets date fields for unfinished jobs, with a suggestion for the unscheduled one", async () => {
  const { body } = await render("gantt");
  assert.doesNotMatch(body, /ดูได้อย่างเดียว/);
  assert.match(body, /data-gt-job="j-rubber" data-gt-version="1"/);
  assert.match(body, /data-gt-job="j-other" data-gt-version="4"/, "each row carries the schedule version it was read at");
  assert.match(body, /name="start" value="2026-10-12"[^>]*aria-label="วันเริ่มของ TEST-JB-26-001"/);
  const none = body.slice(body.indexOf('data-gt-job="j-none"'), body.indexOf('data-gt-job="j-other"'));
  assert.match(none, /name="start" value="2026-10-12"/, "suggested start is today");
  assert.match(none, /name="end" value="2026-10-12"/, "110 minutes fit in one working day");
  assert.match(none, /ค่าที่เสนอ ยังไม่บันทึก/);
  assert.match(none, /กำหนดตาราง<\/button>/);
  assert.doesNotMatch(none, /data-gt-nudge/, "nothing to nudge before it is scheduled");
  const rubber = body.slice(body.indexOf('data-gt-job="j-rubber"'), body.indexOf('data-gt-job="j-part"'));
  assert.equal([...rubber.matchAll(/data-gt-nudge/g)].length, 2);
  const done = body.slice(body.indexOf('data-gt-job="j-done"'), body.indexOf('data-gt-job="j-other"'));
  assert.doesNotMatch(done, /<input/, "a finished job cannot be re-scheduled");
});

test("someone who may not edit sees the chart and the dates read-only with the reason", async () => {
  const { body } = await render("gantt", { data: { ...FIXTURE, can_edit: false } });
  assert.match(body, /ดูได้อย่างเดียว — แก้ตารางได้เฉพาะแผนก PP, ผู้จัดการทั่วไป, ผู้จัดการโรงงาน และผู้ช่วยผู้จัดการโรงงาน/);
  assert.doesNotMatch(body, /<input/);
  assert.doesNotMatch(body, /data-gt-save|data-gt-nudge/);
  assert.match(body, /gantt-bar/, "the chart is still there");
  assert.match(body, /d\(2026-10-12\)/, "and the planned dates");
});

test("an empty database shows how to get started instead of an empty chart", async () => {
  const { body } = await render("gantt", { data: { can_edit: true, work_centers: [], orders: [], jobs: [] } });
  assert.match(body, /ยังไม่มีใบงานให้แสดง/);
  assert.match(body, /href="#\/factory\?item=job-new"/);
  assert.doesNotMatch(body, /gantt-bar/);
});

test("saving a job sends the schedule version it was read at and shows the result", async () => {
  const row = fakeRow("j-rubber", 1, "2026-10-12", "2026-10-14");
  const { log } = await render("gantt", { rows: [row] });
  row.inputs.start.value = "2026-10-15";
  row.inputs.end.value = "2026-10-20";
  await row.save.handlers.click();
  assert.deepEqual(plain(log.calls.at(-1)), ["app_factory_schedule_job", { p_id: "j-rubber", p_schedule_version: 1, p_start: "2026-10-15", p_end: "2026-10-20", p_note: "" }]);
  assert.deepEqual(plain(log.toasts), [["บันทึกตารางเวลาแล้ว", "ok"]]);
  assert.equal(log.renders, 1, "the page is drawn again with the new versions");
});

test("the nudge buttons move both dates by one day, across month ends", async () => {
  const row = fakeRow("j-rubber", 2, "2026-10-31", "2026-11-02");
  const { log } = await render("gantt", { rows: [row] });
  await row.nudges[1].handlers.click();
  assert.deepEqual(plain(log.calls.at(-1)), ["app_factory_schedule_job", { p_id: "j-rubber", p_schedule_version: 2, p_start: "2026-11-01", p_end: "2026-11-03", p_note: "" }]);
  await row.nudges[0].handlers.click();
  assert.deepEqual(plain(log.calls.at(-1))[1], { p_id: "j-rubber", p_schedule_version: 2, p_start: "2026-10-30", p_end: "2026-11-01", p_note: "" });
  assert.deepEqual(plain(log.toasts), [["เลื่อนตารางเวลาแล้ว", "ok"], ["เลื่อนตารางเวลาแล้ว", "ok"]]);
});

test("bad dates are stopped in the browser before any request, with the same message the database gives", async () => {
  const row = fakeRow("j-rubber", 1, "2026-10-12", "2026-10-14");
  const { log } = await render("gantt", { rows: [row] });
  const before = log.calls.length;
  row.inputs.end.value = "2026-10-01";
  await row.save.handlers.click();
  row.inputs.start.value = "";
  await row.save.handlers.click();
  row.inputs.start.value = "2026-10-12";
  row.inputs.end.value = "";
  await row.nudges[1].handlers.click();
  assert.equal(log.calls.length, before, "no RPC was called");
  assert.equal(log.toasts.length, 3);
  for (const [message, kind] of log.toasts) {
    assert.equal(kind, "error");
    assert.match(message, /วันที่ไม่ถูกต้อง/);
  }
});

test("a rejected save shows the Thai message; a stale or finished job reloads the page, a permission error does not", async () => {
  const stale = fakeRow("j-rubber", 1, "2026-10-12", "2026-10-14");
  const first = await render("gantt", { rows: [stale], rpc: async (name) => (name === "app_factory_schedule_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "SCHEDULE_STALE" } }) });
  await stale.save.handlers.click();
  assert.deepEqual(plain(first.log.toasts), [["ตารางของใบงานนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจตารางล่าสุดแล้วทำอีกครั้ง", "error"]]);
  assert.equal(first.log.renders, 1, "the page reloads so the user sees the newer dates");
  const denied = fakeRow("j-rubber", 1, "2026-10-12", "2026-10-14");
  const second = await render("gantt", { rows: [denied], rpc: async (name) => (name === "app_factory_schedule_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "SCHEDULE_NOT_ALLOWED" } }) });
  await denied.save.handlers.click();
  assert.match(second.log.toasts[0][0], /แก้ตารางการผลิตได้เฉพาะแผนก PP/);
  assert.equal(second.log.renders, 0, "no reload for an error the page cannot fix");
  assert.equal(denied.save.disabled, false, "the button is usable again");
});

test("the calendar page shows each center's shift and its capacity per day, and who changed it last", async () => {
  const { body, actions } = await render("gantt-calendar");
  assert.equal(actions, undefined);
  assert.match(text(body), /RB ศูนย์ RB/);
  assert.match(text(body), /กะ 08:00–17:00 พัก 60 นาที/);
  assert.match(text(body), /วันทำงาน จันทร์–ศุกร์/);
  assert.match(text(body), /กำลังการผลิตต่อวัน 480 นาที \(8 ชม\.\)/);
  assert.match(text(body), /GR[\s\S]*เครื่อง\/สาย × ประสิทธิภาพ 2 × 50%/);
  assert.match(text(body), /แก้ล่าสุดโดย ทดสอบ พนักงานวางแผน/);
  assert.match(text(body), /ยังเป็นค่าตั้งต้น/);
  assert.match(text(body), /วันที่เกินกำลัง 3 วัน/, "RB");
  assert.match(body, /data-gt-calendar="RB" data-gt-version="3"/);
  assert.equal([...body.matchAll(/name="day" value="[1-7]"/g)].length, 14, "seven weekday boxes per center");
  assert.equal([...body.matchAll(/name="day" value="[1-5]" checked/g)].length, 10, "Monday to Friday are ticked");
  const readOnly = await render("gantt-calendar", { data: { ...FIXTURE, can_edit: false } });
  assert.doesNotMatch(readOnly.body, /<form|<input/);
  assert.match(readOnly.body, /ดูได้อย่างเดียว/);
  const empty = await render("gantt-calendar", { data: { ...FIXTURE, work_centers: [] } });
  assert.match(empty.body, /ยังไม่มีศูนย์งาน/);
});

function fakeForm(code, version, values) {
  const errorBox = element({ hidden: true });
  return { dataset: { gtCalendar: code, gtVersion: String(version) }, __values: values, errorBox, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector: (selector) => (selector === '[role="alert"]' ? errorBox : null) };
}
const GOOD = { shift_start: "07:30", shift_end: "19:30", break_minutes: "90", units: "2", efficiency: "85.5", day: ["1", "2", "3", "6"] };

test("saving a calendar sends the shift, days, machines and efficiency with the version it was read at", async () => {
  const form = fakeForm("RB", 3, GOOD);
  const { log } = await render("gantt-calendar", { forms: [form] });
  await form.handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(log.calls.at(-1)), ["app_factory_save_work_center_calendar", {
    p_code: "RB", p_calendar_version: 3, p_shift_start: "07:30", p_shift_end: "19:30", p_break_minutes: 90, p_working_days: [1, 2, 3, 6], p_units: 2, p_efficiency: 85.5,
  }]);
  assert.deepEqual(plain(log.toasts), [["บันทึกปฏิทินศูนย์งาน RB แล้ว", "ok"]]);
  assert.equal(log.renders, 1);
});

test("an invalid calendar is stopped in the browser with the message in the form and no request", async () => {
  const cases = {
    "no working day": { day: [] }, "shift ends before it starts": { shift_start: "17:00", shift_end: "08:00" }, "a break as long as the shift": { break_minutes: "720" },
    "negative break": { break_minutes: "-5" }, "half a minute of break": { break_minutes: "1.5" }, "no machines": { units: "0" }, "101 machines": { units: "101" },
    "zero efficiency": { efficiency: "0" }, "efficiency over 100": { efficiency: "100.5" }, "empty efficiency": { efficiency: "" }, "missing times": { shift_start: "" },
  };
  for (const [label, change] of Object.entries(cases)) {
    const form = fakeForm("RB", 3, { ...GOOD, ...change });
    const { log } = await render("gantt-calendar", { forms: [form] });
    const before = log.calls.length;
    form.errorBox.hidden = true;
    await form.handlers.submit({ preventDefault() {} });
    assert.equal(log.calls.length, before, `${label}: no RPC`);
    assert.equal(form.errorBox.hidden, false, `${label}: the message is shown`);
    assert.match(form.errorBox.textContent, /ปฏิทินศูนย์งานไม่ถูกต้อง/, label);
  }
});

test("a stale calendar reloads the page", async () => {
  const form = fakeForm("RB", 1, GOOD);
  const { log } = await render("gantt-calendar", { forms: [form], rpc: async (name) => (name === "app_factory_schedule_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "CALENDAR_STALE" } }) });
  await form.handlers.submit({ preventDefault() {} });
  assert.match(log.toasts[0][0], /ปฏิทินของศูนย์งานนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว/);
  assert.equal(log.renders, 1);
});
