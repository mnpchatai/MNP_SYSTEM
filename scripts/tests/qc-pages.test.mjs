import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลด modules/module-qc.js (หน้า #/qc) พร้อม qc-model.js และ qc-sheet.js เข้า context จำลองที่มี helper ของ app.js แบบ stub
// แล้วเรียกหน้าจริงกับ sb.rpc ปลอม ตรวจ HTML ที่ใส่ลงในแอป
const FILES = ["modules/qc-model.js", "modules/qc-sheet.js", "modules/module-qc.js"];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const REPORT = {
  id: "r1", report_no: "TEST-QC-26-001", template_id: "t1", part_number: "P-100", part_name: "ยางรองเครื่อง", customer: "ลูกค้า A", order_no: "SO-7", code: "C9",
  compound_lots: ["LOT-1", "LOT-2"], sample_label: "2M", inspected_by: "emp-qa", inspected_at: "2026-10-27T02:30:00+00:00", inspector_name: "สมชาย ใจดี",
  inspector: { first_name: "สมชาย", last_name: "ใจดี", job_title: "QC" }, result: "ng", status: "pending_qa_manager", current_step: 1, remark: "ค่าความหนาต่ำ", version: 4,
  ncr_id: null, ncr_no: null, created_by: "emp-qa", created_at: "2026-10-27T02:00:00+00:00", updated_at: "2026-10-27T02:40:00+00:00",
  items: [
    { item_no: "A", sort_order: 1, name: "ความหนา", instrument: "Caliper", unit: "mm", spec_min: 12, spec_std: 13, spec_max: 14, points: [9.13, 8.95, 9.27], point_min: 8.95, point_max: 9.27, point_avg: 9.1167, judge: "N", note: "" },
    { item_no: "B", sort_order: 2, name: "ความกว้าง", instrument: "", unit: "mm", spec_min: 1, spec_std: null, spec_max: 3, points: [2], point_min: 2, point_max: 2, point_avg: 2, judge: "O", note: "" },
    { item_no: "D", sort_order: 3, name: "รูปร่าง", instrument: "", unit: "", spec_min: null, spec_std: null, spec_max: null, points: [1], point_min: 1, point_max: 1, point_avg: 1, judge: "NA", note: "" },
    { item_no: "E", sort_order: 4, name: "ความแข็ง", instrument: "", unit: "", spec_min: 60, spec_std: null, spec_max: 70, points: [75], point_min: 75, point_max: 75, point_avg: 75, judge: "AC", note: "ลูกค้าอนุโลม" },
  ],
  approvals: [
    { step_order: 1, step_code: "qa_manager", status: "pending", acted_by: null, acted_at: null, comment: "", first_name: null, last_name: null },
    { step_order: 2, step_code: "factory_manager", status: "pending", acted_by: null, acted_at: null, comment: "", first_name: null, last_name: null },
    { step_order: 3, step_code: "general_manager", status: "pending", acted_by: null, acted_at: null, comment: "", first_name: null, last_name: null },
  ],
  history: [
    { id: 2, action: "submit", status_after: "pending_qa_manager", version: 4, note: "", changed_by_name: "สมชาย ใจดี", created_at: "2026-10-27T02:40:00+00:00" },
    { id: 1, action: "create", status_after: "draft", version: 1, note: "", changed_by_name: "สมชาย ใจดี", created_at: "2026-10-27T02:00:00+00:00" },
  ],
  lab: [
    { lot_number: "LOT-1", found: true, material: "MS-01", tests: 3, latest_test_date: "2026-10-20", avg_mh: 18.234, avg_mv: 62.5 },
    { lot_number: "LOT-2", found: false, material: null, tests: 0, latest_test_date: null, avg_mh: null, avg_mv: null },
  ],
};
const LISTED = { id: "r1", report_no: "TEST-QC-26-001", part_number: "P-100", part_name: "ยางรองเครื่อง", customer: "ลูกค้า A", order_no: "SO-7", compound_lots: ["LOT-1"], inspected_at: "2026-10-27T02:30:00+00:00", inspector_name: "สมชาย ใจดี", result: "ng", status: "pending_qa_manager", version: 4, ncr_no: null };
const TEMPLATE = { id: "t1", part_number: "P-100", part_name: "ยางรองเครื่อง", customer: "ลูกค้า A", drawing_note: "", status: "active", version: 2, items: [
  { item_no: "A", sort_order: 1, name: "ความหนา", instrument: "Caliper", unit: "mm", spec_min: 12, spec_std: 13, spec_max: 14, points_required: 5 },
  { item_no: "B", sort_order: 2, name: "ความกว้าง", instrument: "", unit: "mm", spec_min: 1, spec_std: null, spec_max: 3, points_required: 3 }] };
const EDIT = { read: true, edit: true, steps: [] };

// ตัวแทน DOM ที่ยอมรับทุกการเรียก (ไม่มี jsdom) — ใช้ให้ปุ่ม/ฟอร์มผูก event ได้โดยไม่ล้ม ส่วนที่ตรวจคือ HTML ที่ใส่ลง app.innerHTML
const dom = () => new Proxy(function stub() {}, {
  get: (target, key) => (key === "then" ? undefined : key === "length" ? 0 : key === Symbol.toPrimitive ? () => "" : key === "value" ? "" : dom()),
  apply: () => dom(),
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function load({ sandbox = true, route = "", access = EDIT, fixtures = {}, employee = {}, sandboxState = { active: true } } = {}) {
  const calls = { notFound: 0, rpc: [], toasts: [], synced: [], closed: 0 };
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const data = { app_qc_access: access, app_qc_reports: { reports: [LISTED] }, app_qc_report: REPORT, app_qc_templates: [TEMPLATE], app_qc_lots: [], ...fixtures };
  Object.assign(context, {
    window: context, console, escapeHtml, formatDate: (value) => `D(${value})`, showToast: (message) => calls.toasts.push(message), friendlyError: (error) => String(error?.message ?? error),
    setFormBusy() {}, renderRoute: async () => {}, confirm: () => true, closePopup: () => { calls.closed += 1; },
    URLSearchParams, Intl, Date, Number, Object, Promise, location: { hash: "" }, FormData: class {},
    app, state: { employee: { id: "emp-gm", isSandbox: sandbox, ...employee }, sandbox: sandboxState },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {},
    renderNotFound: () => { calls.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    document: { querySelector: () => dom() },
    sb: {
      rpc: async (name, args) => {
        calls.rpc.push([name, args]);
        const value = data[name];
        if (value instanceof Error) return { data: null, error: value };
        return { data: value ?? null, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ code: "DIM", name_th: "ขนาดผิด" }], error: null }) }) }) }),
    },
    MNP_REQUEST_MODULES: {},
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  context.MNP_QC_SHEET.sync = (record) => { calls.synced.push(record); return true; };
  return { context, app, calls, params: new URLSearchParams(route) };
}
const page = async (route, options = {}) => {
  const env = load({ route, ...options });
  await env.context.MNP_REQUEST_MODULES.QC.pages.qc(env.params);
  return env;
};

test("the module registers a sandbox-only standalone page and navigation entry", () => {
  const { context } = load();
  const registered = context.MNP_REQUEST_MODULES.QC;
  assert.equal(registered.code, "QC");
  assert.equal(registered.enabled, true);
  assert.equal(registered.sandbox, true);
  assert.equal(registered.standalone, true);
  assert.equal(registered.label, "ใบตรวจ QC");
  assert.equal(registered.nav[0].sandboxOnly, true);
  assert.equal(registered.nav[0].path, "qc");
  assert.equal(typeof registered.pages.qc, "function");
  assert.equal(registered.errorMessages, context.MNP_QC_MODEL.ERROR_MESSAGES);
  assert.equal(registered.theme.length, 2);
});

test("outside test mode the page is not found and nothing is loaded", async () => {
  const { calls, app } = await page("", { sandbox: false });
  assert.equal(calls.notFound, 1);
  assert.equal(app.innerHTML, "<notfound></notfound>");
  assert.equal(calls.rpc.length, 0);
});

test("a persona without read access sees an explanation instead of data", async () => {
  const { app, calls } = await page("", { access: { read: false, edit: false, steps: [] } });
  assert.match(app.innerHTML, /ดูใบตรวจ QC ไม่ได้/);
  assert.deepEqual(calls.rpc.map(([name]) => name), ["app_qc_access"]);
});

test("the list shows each report with its status badge and the actions the persona may use", async () => {
  const { app, calls } = await page("");
  assert.match(app.innerHTML, /<shell path="qc" title="ใบตรวจ QC">/);
  assert.match(app.innerHTML, /href="#\/qc\?view=report&amp;id=r1">TEST-QC-26-001</);
  assert.match(app.innerHTML, /<span class="badge pending_approval">รอ ผจก\.QA<\/span>/);
  assert.match(app.innerHTML, /<span class="badge rejected">ไม่ผ่าน \(Reject\)<\/span>/);
  assert.match(app.innerHTML, /ลูกค้า A/);
  assert.match(app.innerHTML, /LOT-1/);
  assert.match(app.innerHTML, /สร้างใบตรวจ/);
  assert.match(app.innerHTML, /href="#\/qc\?view=templates">แม่แบบตรวจ</);
  assert.match(app.innerHTML, /id="qc-purge-review"/, "an admin in test mode can clear the QC test data");
  assert.deepEqual(plain(calls.rpc[1]), ["app_qc_reports", { p_filter: { status: "", part_number: "", lot: "" } }]);
  const readOnly = await page("", { access: { read: true, edit: false, steps: [] }, sandboxState: null });
  assert.doesNotMatch(readOnly.app.innerHTML, /สร้างใบตรวจ/);
  assert.doesNotMatch(readOnly.app.innerHTML, /qc-purge-review/);
});

test("the list filters are sent to the database and an empty result is explained", async () => {
  const { app, calls } = await page("status=approved&part=P-1&lot=L9", { fixtures: { app_qc_reports: { reports: [] } } });
  assert.deepEqual(plain(calls.rpc[1]), ["app_qc_reports", { p_filter: { status: "approved", part_number: "P-1", lot: "L9" } }]);
  assert.match(app.innerHTML, /ไม่พบใบตรวจที่ตรงกับตัวกรอง/);
  assert.match(app.innerHTML, /<option value="approved" selected>อนุมัติแล้ว<\/option>/);
  const unknown = await page("status=<script>");
  assert.equal(unknown.calls.rpc[1][1].p_filter.status, "", "an unknown status is dropped");
});

test("values from the database are escaped", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const { app } = await page("", { fixtures: { app_qc_reports: { reports: [{ ...LISTED, report_no: evil, part_name: evil }] } } });
  assert.doesNotMatch(app.innerHTML, /<img/);
  const detail = await page("view=report&id=r1", { fixtures: { app_qc_report: { ...REPORT, remark: evil, part_name: evil } } });
  assert.doesNotMatch(detail.app.innerHTML, /<img/);
});

test("the report page shows the form header, items, Mooney rows, signatures and history", async () => {
  const { app, calls } = await page("view=report&id=r1");
  const html = app.innerHTML;
  assert.match(html, /<h1>TEST-QC-26-001<\/h1>/);
  assert.match(html, /<span class="badge pending_approval">รอ ผจก\.QA<\/span>/);
  for (const label of ["Part Number", "Part Name", "customer", "Order No.", "Code", "Inspecter By", "inspection Date", "Results"]) assert.ok(html.includes(`<dt>${label}</dt>`), label);
  assert.match(html, /ยางรองเครื่อง/);
  assert.match(html, /Sample \(2M\)/);
  assert.match(html, /<span class="qc-judge qc-judge-n" title="NG">N<\/span>/);
  assert.match(html, /<span class="qc-judge qc-judge-o" title="OK">O<\/span>/);
  assert.match(html, /<span class="qc-judge qc-judge-ac" title="ACCEPT">AC<\/span>/);
  assert.match(html, /<span class="qc-judge qc-judge-na" title="ไม่มีสเปก">—<\/span>/);
  assert.match(html, /ลูกค้าอนุโลม/, "the note of an accepted item is shown");
  assert.match(html, /<td class="right">9\.1167<\/td>/);
  assert.match(html, /ยางผสม \(Mooney\)/);
  assert.match(html, /<strong>LOT-1<\/strong><\/td><td>MS-01<\/td><td class="right">3<\/td>[\s\S]*?<td class="right">18\.23<\/td><td class="right">62\.50<\/td>/);
  assert.match(html, /<strong>LOT-2<\/strong><\/td><td colspan="5" class="muted">ยังไม่มีผล Mooney ของ Lot นี้ในระบบ<\/td>/);
  assert.doesNotMatch(html, /#\/lab\?module=mooney/, "the Mooney link needs lab access");
  assert.match(html, /qc-sign-role">Inspector<\/span><strong>✓ ลงนามแล้ว<\/strong>/);
  assert.match(html, /manager QA<\/span><strong class="qc-sign-wait">รออนุมัติ<\/strong>/);
  assert.match(html, /factory manager<\/span><strong>—<\/strong>/);
  assert.match(html, /General Manager Approved/);
  assert.match(html, /<strong>ส่งอนุมัติ<\/strong>/);
  assert.match(html, /<strong>สร้างใบตรวจ<\/strong>/);
  assert.deepEqual(plain(calls.rpc[1]), ["app_qc_report", { p_id: "r1" }]);
  assert.equal(calls.synced.length, 1, "the page sends the sheet copy once");
  assert.equal(calls.synced[0].reportNo, "TEST-QC-26-001");
});

test("the Mooney rows show the material as text (no LAB link inside the sandbox)", async () => {
  const { app } = await page("view=report&id=r1", { employee: { labAccess: true } });
  assert.doesNotMatch(app.innerHTML, /href="#\/lab/);
  assert.match(app.innerHTML, /MS-01/);
});

test("the module files load before app.js without touching its helpers", () => {
  // index.html โหลด modules/*.js ก่อน app.js: ตอนโหลดต้องไม่อ้าง escapeHtml/formatDate/... (มีแค่ window กับทะเบียนโมดูล)
  const context = vm.createContext({});
  // ให้เฉพาะสิ่งที่เบราว์เซอร์มีตอนโหลดสคริปต์ (ไม่มี helper ของ app.js เช่น escapeHtml/formatDate/showToast)
  Object.assign(context, { window: context, console, URLSearchParams, Intl, Date, MNP_REQUEST_MODULES: {} });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  assert.equal(context.MNP_REQUEST_MODULES.QC?.code, "QC");
});

test("the download button is hidden until the Apps Script URL is set", async () => {
  const hidden = await page("view=report&id=r1");
  assert.doesNotMatch(hidden.app.innerHTML, /id="qc-export"/);
  const env = load({ route: "view=report&id=r1" });
  Object.defineProperty(env.context.MNP_QC_SHEET, "EXPORT_URL", { value: "https://script.google.com/macros/s/x/exec" });
  await env.context.MNP_REQUEST_MODULES.QC.pages.qc(env.params);
  assert.match(env.app.innerHTML, /id="qc-export"[^>]*>ดาวน์โหลด Excel</);
});

test("a draft shows edit, submit and cancel to QA staff and nothing to a read-only persona", async () => {
  const draft = { ...REPORT, status: "draft", current_step: 0, result: "ng", approvals: [] };
  const { app } = await page("view=report&id=r1", { fixtures: { app_qc_report: draft } });
  assert.match(app.innerHTML, /href="#\/qc\?view=edit&amp;id=r1">แก้ไข</);
  assert.match(app.innerHTML, /data-qc-action="submit"/);
  assert.match(app.innerHTML, /id="qc-cancel-form"/);
  assert.doesNotMatch(app.innerHTML, /id="qc-ncr-form"/, "a draft cannot open an NCR");
  assert.doesNotMatch(app.innerHTML, /qc-decide-form/);
  const readOnly = await page("view=report&id=r1", { fixtures: { app_qc_report: draft }, access: { read: true, edit: false, steps: [] } });
  assert.doesNotMatch(readOnly.app.innerHTML, /data-qc-action|qc-cancel-form|qc-actions/);
});

test("the approver of the current step gets the decision form, unless the report is their own", async () => {
  const access = { read: true, edit: false, steps: ["qa_manager"] };
  const { app } = await page("view=report&id=r1", { access });
  assert.match(app.innerHTML, /id="qc-decide-form"/);
  assert.match(app.innerHTML, /data-decision="approve"/);
  assert.match(app.innerHTML, /data-decision="reject"/);
  const wrongStep = await page("view=report&id=r1", { access: { read: true, edit: false, steps: ["factory_manager"] } });
  assert.doesNotMatch(wrongStep.app.innerHTML, /qc-decide-form/);
  const own = await page("view=report&id=r1", { access, employee: { id: "emp-qa" } });
  assert.doesNotMatch(own.app.innerHTML, /qc-decide-form/);
  assert.match(own.app.innerHTML, /อนุมัติใบตรวจของตัวเองไม่ได้/);
  const creator = await page("view=report&id=r1", { access, fixtures: { app_qc_report: { ...REPORT, inspected_by: "someone", created_by: "emp-gm" } } });
  assert.doesNotMatch(creator.app.innerHTML, /qc-decide-form/, "the creator cannot approve either");
});

test("a rejected report can be reopened or cancelled, with the reason in the history", async () => {
  const rejected = { ...REPORT, status: "rejected", approvals: [{ ...REPORT.approvals[0], status: "rejected", first_name: "สมหญิง", last_name: "ตั้งใจ", acted_at: "2026-10-27T03:00:00+00:00", comment: "ค่าไม่ผ่าน" }, REPORT.approvals[1], REPORT.approvals[2]] };
  const { app } = await page("view=report&id=r1", { fixtures: { app_qc_report: rejected } });
  assert.match(app.innerHTML, /data-qc-action="reopen"/);
  assert.match(app.innerHTML, /id="qc-cancel-form"/);
  assert.match(app.innerHTML, /✗ ไม่อนุมัติ · สมหญิง ตั้งใจ/);
  assert.match(app.innerHTML, /ค่าไม่ผ่าน/);
  assert.doesNotMatch(app.innerHTML, /id="qc-ncr-form"/, "a rejected report cannot open an NCR");
});

test("an Reject result opens an NCR once the report is submitted, then links to it", async () => {
  const { app, calls } = await page("view=report&id=r1");
  assert.match(app.innerHTML, /id="qc-ncr-form"/);
  assert.match(app.innerHTML, /<option value="DIM">ขนาดผิด<\/option>/);
  assert.match(app.innerHTML, /<textarea[^>]*>ค่าความหนาต่ำ<\/textarea>/, "the description starts from the REMARK");
  assert.doesNotMatch(app.innerHTML, /id="qc-cancel-form"/, "a submitted report cannot be cancelled");
  assert.ok(calls.rpc.length >= 2);
  const linked = await page("view=report&id=r1", { fixtures: { app_qc_report: { ...REPORT, status: "approved", ncr_id: "n1", ncr_no: "TEST-QA001/69" } } });
  assert.match(linked.app.innerHTML, /href="#\/ncr\?id=n1">TEST-QA001\/69</);
  assert.doesNotMatch(linked.app.innerHTML, /id="qc-ncr-form"/);
  const accepted = await page("view=report&id=r1", { fixtures: { app_qc_report: { ...REPORT, result: "accept" } } });
  assert.doesNotMatch(accepted.app.innerHTML, /id="qc-ncr-form"/, "only a Reject result opens an NCR");
});

test("an unknown report shows the not found message", async () => {
  const { app } = await page("view=report&id=zzz", { fixtures: { app_qc_report: new Error("QC_NOT_FOUND") } });
  assert.match(app.innerHTML, /ไม่พบใบตรวจ/);
  const none = await page("view=report");
  assert.match(none.app.innerHTML, /ไม่พบใบตรวจ/);
});

test("a database that lacks the migration is explained", async () => {
  const { app } = await page("", { fixtures: { app_qc_access: Object.assign(new Error("not found"), { code: "PGRST202" }) } });
  assert.match(app.innerHTML, /apply migration/);
});

test("the new report form starts from the template list with the Lot picker as a data-popup", async () => {
  const { app } = await page("view=new");
  const html = app.innerHTML;
  assert.match(html, /<option value="t1">P-100<\/option>/);
  assert.match(html, /id="qc-r-date" name="inspected_at" type="datetime-local"/);
  assert.match(html, /<div class="qc-lot-combo">[\s\S]*aria-expanded="false"[\s\S]*<div class="qc-lot-popup" id="qc-lot-popup" data-popup[^>]* hidden>/, "the popup sits in the same parent as its input");
  assert.doesNotMatch(html, /onblur|blur/i, "a popup is never closed from blur");
  assert.match(html, /เลือก Part Number เพื่อแสดงรายการตรวจ/);
  const inactive = await page("view=new", { fixtures: { app_qc_templates: [{ ...TEMPLATE, status: "inactive" }] } });
  assert.doesNotMatch(inactive.app.innerHTML, /<option value="t1">/, "an inactive template cannot start a new report");
  const readOnly = await page("view=new", { access: { read: true, edit: false, steps: [] } });
  assert.match(readOnly.app.innerHTML, /สร้าง\/แก้ไขใบตรวจไม่ได้/);
});

test("editing a draft fills the form from the report and refuses a submitted one", async () => {
  const draft = { ...REPORT, status: "draft", current_step: 0, approvals: [], items: [REPORT.items[0], REPORT.items[1]] };
  const { app } = await page("view=edit&id=r1", { fixtures: { app_qc_report: draft } });
  const html = app.innerHTML;
  assert.match(html, /<option value="t1" selected>P-100<\/option>/);
  assert.match(html, /name="order_no" maxlength="60" value="SO-7"/);
  assert.match(html, /name="inspected_at" type="datetime-local" value="2026-10-27T09:30"/, "Bangkok time");
  assert.match(html, /data-item="A"/);
  assert.match(html, /aria-label="รายการ A จุดที่ 3" value="9\.27"/);
  assert.match(html, /qc-point-off/, "points beyond the template's required count are closed");
  assert.doesNotMatch(html, /aria-label="รายการ B จุดที่ 4"/);
  const submitted = await page("view=edit&id=r1");
  assert.match(submitted.app.innerHTML, /ฉบับร่าง/);
  assert.doesNotMatch(submitted.app.innerHTML, /id="qc-form"/);
});

test("the template list and form", async () => {
  const list = await page("view=templates");
  assert.match(list.app.innerHTML, /href="#\/qc\?view=template&amp;id=t1">P-100</);
  assert.match(list.app.innerHTML, /สร้างแม่แบบ/);
  assert.match(list.app.innerHTML, /<span class="badge completed">ใช้งาน<\/span>/);
  const form = await page("view=template&id=t1");
  assert.match(form.app.innerHTML, /name="item_no" aria-label="ITEM No\." value="A"/);
  assert.match(form.app.innerHTML, /id="qc-add-row"/);
  assert.match(form.app.innerHTML, /data-remove-row/);
  const readOnly = await page("view=template&id=t1", { access: { read: true, edit: false, steps: [] } });
  assert.doesNotMatch(readOnly.app.innerHTML, /qc-add-row|data-remove-row|บันทึกแม่แบบ/);
  const missing = await page("view=template&id=nope");
  assert.match(missing.app.innerHTML, /ไม่พบ/);
  const blank = await page("view=template");
  assert.match(blank.app.innerHTML, /สร้างแม่แบบ/);
});
