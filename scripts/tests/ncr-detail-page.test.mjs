import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลด modules/module-ncr.js พร้อม ncr-costs.js / ncr-loss-form.js เข้า context จำลองที่มีฟังก์ชันของ app.js แบบ stub
// แล้ววาดหน้ารายละเอียด NCR ของพนักงานจริง (ไม่ใช่โหมดทดสอบ) ตรวจ HTML: การ์ดส่วนที่ 1–4 แบบใหม่ และใครเห็นฟอร์มความสูญเสีย
// (ต้องตรงกับ private.can_edit_ncr_losses — ฐานข้อมูลเป็นตัวตัดสินสิทธิ์จริง ดู supabase/tests/database/ncr_loss_editors_same_in_all_modes.test.sql)
const FILES = ["modules/ncr-costs.js", "modules/ncr-loss-form.js", "modules/module-ncr.js"];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const employee = (id, deptId, deptCode, roleCode, isSandbox = false) => ({ id, department_id: deptId, department: { code: deptCode }, role: { code: roleCode }, isSandbox });

const NCR = {
  id: "ncr-1", ncr_no: "QA041/26", form_code: "QA02-FM01", status: "closed", is_test: false, product_name: "ท่อยาง", product_code: "P-1", unit: "ท่อน",
  issue_date: "2026-10-01", reporter_id: "emp-reporter", reporter_department: { code: "RB" }, source: "in_process", defect_type: { name_th: "ขนาดผิด" },
  description: "รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm", qty_total: 100, qty_sampled: 20, qty_defect: 5, qty_returned: 0,
  dispositions: ["sort"], causes: ["machine"], response_due: "2026-10-06", root_cause: "เครื่องสึก", correction: "คัดแยก", prevention: "ซ่อมบำรุง",
  ncr_responsibilities: [{ share: 100, department_id: "dept-rb", department: { code: "RB", name_th: "ขึ้นรูปยาง" } }],
};

// options.tables = { employees, departments, ... } ข้อมูลที่ตารางนั้นตอบกลับ · options.sandbox = state.sandbox
// options.forms = ฟอร์มจำลองที่ bindDetail ผูก handler ให้ (ดู fakeForm) · คืน html กับ rpc ที่ถูกเรียก
async function renderPage(viewer, overrides = {}, options = {}) {
  const report = { ...NCR, ...overrides };
  const app = { innerHTML: "" };
  const rpcCalls = [];
  const forms = options.forms ?? [];
  const query = (table) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      maybeSingle: async () => ({ data: table === "ncr_reports" ? report : null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: options.tables?.[table] ?? [], error: null }).then(resolve, reject),
    };
    return builder;
  };
  const noop = () => {};
  const context = {
    app, console, Intl, Date, Map, Set, Promise, URLSearchParams,
    state: { employee: viewer, sandbox: options.sandbox },
    sb: { from: query, rpc: async (name, args) => { rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return { data: null, error: null }; } },
    shell: (content) => content, bindShell: noop, loadingShell: noop, showToast: noop, friendlyError: String, setFormBusy: noop,
    escapeHtml, formatDate: (value) => String(value ?? "—"), relation: (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null),
    loadEmployeeDirectory: async () => new Map(), personName: () => "ผู้ทดสอบ",
    DEPT_MANAGER_ROLE_CODES: ["department_manager", "assistant_department_manager"],
    optionalAttachments: () => [], uploadAttachmentBatch: async () => ({ total: 0, failed: [] }), attachmentBatchFailureText: () => "",
    attachmentGalleryHtml: () => "", hydrateAttachmentGallery: async () => {}, openAttachmentLightbox: noop,
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fields?.[name] ?? null; } },
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => (selector === "form.ncr-action" ? forms
        : selector === 'form[data-action="dispose"]' ? forms.filter((form) => form.dataset.action === "dispose") : []),
    },
  };
  context.window = context;
  context.window.MNP_NCR_ATTACHMENTS = { fieldHtml: () => "", bucket: () => "ncr-attachments", uploadOne: async () => {} };
  context.window.MNP_NCR_SHEET_SYNC = { sync: noop, buildRecord: () => ({}) };
  vm.createContext(context);
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  await context.window.MNP_REQUEST_MODULES.NCR_CAR.pages.ncr(new URLSearchParams({ id: report.id }));
  return { html: app.innerHTML, rpcCalls };
}

const renderFor = async (viewer, overrides = {}, options = {}) => (await renderPage(viewer, overrides, options)).html;

test("a real NCR shows the four part cards with the quantity summary", async () => {
  const html = await renderFor(employee("emp-qa", "dept-qa", "QA", "staff"));
  for (const part of [1, 2, 3, 4]) {
    assert.match(html, new RegExp(`ncr-detail-part ncr-detail-part--${part}`), `part ${part} uses the card layout`);
    assert.match(html, new RegExp(`aria-labelledby="ncr-part-${part}-title"`), `part ${part} heading is linked to its card`);
  }
  assert.match(html, /ncr-quantity-summary/);
  assert.match(html, /ncr-fact-icon/);
  assert.match(html, /<dt>พบปัญหา<\/dt><dd>5<\/dd>/);
  assert.match(html, /%NG จากการสุ่ม/);
});

test("the detail page markup is identical in test mode and real mode, for real and test reports", async () => {
  const base = await renderFor(employee("emp-fm", "dept-ft", "FT", "factory_manager", false), { is_test: false });
  for (const part of [1, 2, 3, 4]) assert.match(base, new RegExp(`ncr-detail-part--${part}`), `part ${part} card`);
  assert.match(base, /ncr-quantity-summary/, "quantity summary");
  for (const isSandbox of [false, true]) {
    for (const isTest of [false, true]) {
      const html = await renderFor(employee("emp-fm", "dept-ft", "FT", "factory_manager", isSandbox), { is_test: isTest });
      assert.equal(html, base, `sandbox viewer=${isSandbox}, test report=${isTest}: markup differs from the real-mode page`);
    }
  }
});

test("who sees the loss form on a real NCR matches private.can_edit_ncr_losses", async () => {
  // NCR ใบนี้ให้แผนก RB รับผิดชอบ — หัวหน้า RB จึงไม่มีสิทธิ์แล้ว (migration 20261017030000)
  const cases = [
    ["factory manager", employee("e1", "dept-ft", "FT", "factory_manager"), true],
    ["assistant factory manager", employee("e2", "dept-ft", "FT", "assistant_factory_manager"), true],
    ["general manager", employee("e3", "dept-mgt", "MGT", "general_manager"), true],
    ["QA department manager", employee("e9", "dept-qa", "QA", "department_manager"), true],
    ["QA assistant department manager", employee("e10", "dept-qa", "QA", "assistant_department_manager"), true],
    ["manager of the responsible department", employee("e4", "dept-rb", "RB", "department_manager"), false],
    ["assistant manager of the responsible department", employee("e5", "dept-rb", "RB", "assistant_department_manager"), false],
    ["manager of another department", employee("e6", "dept-pk", "PK", "department_manager"), false],
    ["staff of the responsible department", employee("e7", "dept-rb", "RB", "staff"), false],
    ["QA staff", employee("e8", "dept-qa", "QA", "staff"), false],
  ];
  for (const [label, viewer, editable] of cases) {
    const html = await renderFor(viewer);
    assert.equal(html.includes('id="ncr-loss-form"'), editable, `${label}: loss form ${editable ? "shown" : "hidden"}`);
  }
});

test("an admin account counts as its working role for the loss form, but not for signing off", async () => {
  // บัญชี admin ที่ตั้ง "บทบาทหลักในการทำงาน" (state.employee.actingRole) — ตรงกับ private.can_edit_ncr_losses ใน migration 20261101010000
  const admin = (id, deptId, deptCode, actingRoleCode) => ({ ...employee(id, deptId, deptCode, "admin"), actingRole: actingRoleCode ? { code: actingRoleCode } : null });
  const cases = [
    ["admin working as general manager", admin("a1", "dept-mgt", "MGT", "general_manager"), true],
    ["admin working as assistant factory manager", admin("a2", "dept-ft", "FT", "assistant_factory_manager"), true],
    ["admin working as factory manager", admin("a3", "dept-ft", "FT", "factory_manager"), true],
    ["admin in QA working as department manager", admin("a4", "dept-qa", "QA", "department_manager"), true],
    ["admin outside QA working as department manager", admin("a5", "dept-rb", "RB", "department_manager"), false],
    ["admin working as staff", admin("a6", "dept-qa", "QA", "staff"), false],
    ["admin without a working role", admin("a7", "dept-mgt", "MGT", null), false],
  ];
  for (const [label, viewer, editable] of cases) {
    const html = await renderFor(viewer);
    assert.equal(html.includes('id="ncr-loss-form"'), editable, `${label}: loss form ${editable ? "shown" : "hidden"}`);
  }
  // ขั้นลงนามยังตรวจ role จริง (app_ncr_signoff) จึงไม่แสดงปุ่มลงนามให้ admin แม้บทบาทหลักตรงกับขั้นนั้น
  const awaitingGm = { status: "awaiting_signoff", signoff_qa_at: "2026-10-10", signoff_factory_at: "2026-10-11" };
  assert.doesNotMatch(await renderFor(admin("a1", "dept-mgt", "MGT", "general_manager"), awaitingGm), /data-action="signoff"/);
  assert.match(await renderFor(employee("e3", "dept-mgt", "MGT", "general_manager"), awaitingGm), /data-action="signoff"/);
});

test("a cancelled NCR locks the loss form for everyone, and the responsible department does not change who can edit", async () => {
  const factoryManager = employee("e1", "dept-ft", "FT", "factory_manager");
  const qaManager = employee("e9", "dept-qa", "QA", "department_manager");
  for (const viewer of [factoryManager, qaManager]) {
    assert.equal((await renderFor(viewer, { status: "cancelled" })).includes('id="ncr-loss-form"'), false, "cancelled report: form hidden");
  }
  const qaResponsible = { ncr_responsibilities: [{ share: 100, department_id: "dept-qa", department: { code: "QA", name_th: "QA" } }] };
  assert.equal((await renderFor(qaManager, qaResponsible)).includes('id="ncr-loss-form"'), true, "QA manager, QA responsible: form shown");
  assert.equal((await renderFor(qaManager)).includes('id="ncr-loss-form"'), true, "QA manager, QA not responsible: form shown");
  assert.equal((await renderFor(employee("e8", "dept-qa", "QA", "staff"), qaResponsible)).includes('id="ncr-loss-form"'), false, "QA staff even when QA is responsible: form hidden");
  assert.equal((await renderFor(employee("e4", "dept-rb", "RB", "department_manager"))).includes('id="ncr-loss-form"'), false, "responsible department manager: form hidden");
});

test("read-only viewers are told who can enter costs; editors are not", async () => {
  const readOnly = await renderFor(employee("e8", "dept-qa", "QA", "staff"));
  assert.match(readOnly, /ประเมินค่าเสียหายยังไม่ครบ · ผู้กรอกได้: ผจก\.ทั่วไป, ผจก\.โรงงาน, ผช\.ผจก\.โรงงาน และ ผจก\.\/ผช\.ผจก\.แผนก QA/);
  const editor = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"));
  assert.doesNotMatch(editor, /ผู้กรอกได้:/);
  // ใบที่ยกเลิกล็อกทุกคน จึงไม่ชี้ไปหาใคร
  for (const viewer of [employee("e8", "dept-qa", "QA", "staff"), employee("e1", "dept-ft", "FT", "factory_manager"), employee("e9", "dept-qa", "QA", "department_manager")]) {
    assert.doesNotMatch(await renderFor(viewer, { status: "cancelled" }), /ผู้กรอกได้:/, "cancelled report: no hint");
  }
});

test("the disposition form states the actual due date, which is set when the NCR is issued", async () => {
  const html = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"), { status: "awaiting_disposition", response_due: "2026-10-06" });
  assert.match(html, /บันทึกและส่งแผนก \(ตอบภายใน 2026-10-06\)/);
  assert.doesNotMatch(html, /ตอบภายใน \d+ วัน/, "no fixed number of days in the button");
});

// ---- ผู้ตอบ NCR: พนักงานหรือหัวหน้าของแผนกที่รับผิดชอบ และระบุตัวผู้ตอบได้ (migration 20261020010000) ----
// ฝั่งฐานข้อมูลตัดสินสิทธิ์จริง (private.ncr_can_respond, supabase/tests/database/ncr_responder_designation.test.sql)
// ที่นี่ตรวจว่าหน้าจอแสดงฟอร์มตรงกับกฎเดียวกัน
const person = (id, deptId, deptCode, roleCode, first = id) => ({ id, first_name: first, last_name: "ทดสอบ", department_id: deptId, role: { code: roleCode }, department: { code: deptCode } });
const responsibility = (deptId, code, responderId = null) => ({ share: 1, department_id: deptId, responder_id: responderId, department: { code, name_th: code } });
const RB_STAFF_1 = employee("s1", "dept-rb", "RB", "staff");
const RB_STAFF_2 = employee("s2", "dept-rb", "RB", "staff");
const RB_MANAGER = employee("m1", "dept-rb", "RB", "department_manager");
const RB_ASSISTANT = employee("a1", "dept-rb", "RB", "assistant_department_manager");
const PK_STAFF = employee("p1", "dept-pk", "PK", "staff");
const QA_STAFF = employee("q1", "dept-qa", "QA", "staff");
const FACTORY_MANAGER = employee("fm", "dept-ft", "FT", "factory_manager");
const GENERAL_MANAGER = employee("gm", "dept-mgt", "MGT", "general_manager");
const has = (html, action) => html.includes(`data-action="${action}"`);

test("anyone eligible in the responsible department sees the respond form when nobody is named", async () => {
  const open = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] };
  for (const [label, viewer, shown] of [
    ["staff of the responsible department", RB_STAFF_1, true],
    ["another staff member of the responsible department", RB_STAFF_2, true],
    ["manager of the responsible department", RB_MANAGER, true],
    ["assistant manager of the responsible department", RB_ASSISTANT, true],
    ["staff of an unrelated department", PK_STAFF, false],
    ["QA staff", QA_STAFF, false],
    ["factory manager", FACTORY_MANAGER, false],
    ["general manager", GENERAL_MANAGER, false],
  ]) {
    assert.equal(has(await renderFor(viewer, open), "respond"), shown, `${label}: respond form ${shown ? "shown" : "hidden"}`);
  }
});

test("only the named person sees the respond form when the department names one", async () => {
  const named = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1")] };
  for (const [label, viewer, shown] of [
    ["the named staff member", RB_STAFF_1, true],
    ["another staff member of the same department", RB_STAFF_2, false],
    ["the manager of the same department", RB_MANAGER, false],
    ["staff of an unrelated department", PK_STAFF, false],
  ]) {
    assert.equal(has(await renderFor(viewer, named), "respond"), shown, `${label}: respond form ${shown ? "shown" : "hidden"}`);
  }
  // แผนกที่สองไม่ระบุ: ทุกคนในแผนกนั้นยังตอบได้
  const mixed = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1"), responsibility("dept-gr", "GR")] };
  assert.equal(has(await renderFor(employee("g1", "dept-gr", "GR", "staff"), mixed), "respond"), true, "an open department next to a named one stays open");
  assert.equal(has(await renderFor(RB_MANAGER, mixed), "respond"), false, "the named department stays closed to its manager");
});

test("the prevention and the information answer follow the same rule as the response", async () => {
  const cases = [
    ["awaiting_followup", "submit_prevention", { prevention: null, prevention_due: "2026-10-13" }],
    ["awaiting_info", "answer_info", {}],
  ];
  for (const [status, action, extra] of cases) {
    const open = { status, ...extra, ncr_responsibilities: [responsibility("dept-rb", "RB")] };
    const named = { status, ...extra, ncr_responsibilities: [responsibility("dept-rb", "RB", "s1")] };
    assert.equal(has(await renderFor(RB_STAFF_2, open), action), true, `${action}: staff, nobody named`);
    assert.equal(has(await renderFor(PK_STAFF, open), action), false, `${action}: unrelated staff`);
    assert.equal(has(await renderFor(RB_STAFF_1, named), action), true, `${action}: the named staff member`);
    assert.equal(has(await renderFor(RB_MANAGER, named), action), false, `${action}: another person of the department`);
  }
});

const DEPARTMENTS = [{ id: "dept-rb", code: "RB", name_th: "ขึ้นรูปยาง" }, { id: "dept-gr", code: "GR", name_th: "แปรรูปยาง" }, { id: "dept-pp", code: "PP", name_th: "วางแผน" }];
const ROSTER = [
  person("s1", "dept-rb", "RB", "staff", "สมชาย"), person("m1", "dept-rb", "RB", "department_manager", "มานะ"),
  person("a2", "dept-gr", "GR", "assistant_department_manager", "อารี"), person("gm", "dept-mgt", "MGT", "general_manager", "ใหญ่"),
];

test("the disposition form offers an optional responder picker per department that has eligible people", async () => {
  const html = await renderFor(FACTORY_MANAGER, { status: "awaiting_disposition", ncr_responsibilities: [] }, { tables: { departments: DEPARTMENTS, employees: ROSTER } });
  const picker = (id) => html.match(new RegExp(`<div class="field ncr-responder-pick" data-responder-dept="${id}" hidden>.*?</div>`))?.[0];
  const rb = picker("dept-rb");
  assert.ok(rb, "RB has a picker (hidden until RB is ticked)");
  assert.match(rb, /<select class="select" id="ncr-responder-dept-rb" name="responder" disabled>/, "disabled while hidden so it is never submitted");
  assert.match(rb, /<option value="">ไม่ระบุ — ทุกคนในแผนกตอบได้<\/option>/, "the empty choice means nobody is named");
  assert.match(rb, /<option value="s1">สมชาย ทดสอบ · พนักงาน<\/option>/);
  assert.match(rb, /<option value="m1">มานะ ทดสอบ · ผจก\.แผนก<\/option>/);
  assert.match(picker("dept-gr"), /อารี ทดสอบ · ผช\.ผจก\.แผนก/);
  assert.equal(picker("dept-pp"), undefined, "PP has nobody to choose, so no picker");
  assert.doesNotMatch(html, /ใหญ่ ทดสอบ/, "a general manager is not an eligible responder");
});

test("in the sandbox the picker lists the test personas, not real employees", async () => {
  const personas = [person("sbx-rb-staff", "dept-rb", "RB", "staff", "ทดลอง")];
  const html = await renderFor(employee("sbx-fm", "dept-ft", "FT", "factory_manager", true), { status: "awaiting_disposition", ncr_responsibilities: [] },
    { tables: { departments: DEPARTMENTS, employees: ROSTER }, sandbox: { personas } });
  assert.match(html, /<option value="sbx-rb-staff">ทดลอง ทดสอบ · พนักงาน<\/option>/);
  assert.doesNotMatch(html, /สมชาย/, "real employees are not offered for a test NCR");
});

test("the factory manager can change the responder only while the department still has work to do", async () => {
  const named = [responsibility("dept-rb", "RB", "s1"), responsibility("dept-gr", "GR")];
  const tables = { employees: ROSTER };
  for (const status of ["awaiting_response", "awaiting_followup", "awaiting_info"]) {
    const html = await renderFor(FACTORY_MANAGER, { status, ncr_responsibilities: named }, { tables });
    assert.equal((html.match(/data-action="assign_responder"/g) ?? []).length, 2, `${status}: one form per responsible department`);
    assert.match(html, /data-department-id="dept-rb"/);
    assert.match(html, /<option value="s1" selected>/, `${status}: the current responder is preselected`);
  }
  for (const status of ["awaiting_disposition", "awaiting_signoff", "closed", "cancelled"]) {
    assert.equal(has(await renderFor(FACTORY_MANAGER, { status, ncr_responsibilities: named }, { tables }), "assign_responder"), false, `${status}: no form`);
  }
  for (const viewer of [employee("qm", "dept-qa", "QA", "department_manager"), RB_MANAGER, RB_STAFF_1]) {
    assert.equal(has(await renderFor(viewer, { status: "awaiting_response", ncr_responsibilities: named }, { tables }), "assign_responder"), false, "only the factory manager can change it");
  }
  // ผู้ที่ระบุไว้ใช้งานไม่ได้แล้ว (ปิดบัญชี/ย้ายแผนก): ยังเห็นว่าระบุใครไว้ และเปลี่ยนได้
  const gone = await renderFor(FACTORY_MANAGER, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "left")] }, { tables });
  assert.match(gone, /<option value="left" selected>ผู้ทดสอบ \(ใช้งานไม่ได้แล้ว\)<\/option>/);
});

test("people who cannot act are told which department members, or which named person, the NCR waits for", async () => {
  const tables = { employees: [...ROSTER, person("s9", "dept-rb", "RB", "staff", "สุดา"), person("s8", "dept-rb", "RB", "staff", "สมศรี"), person("s7", "dept-rb", "RB", "staff", "สมหมาย")] };
  const open = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB"), responsibility("dept-pp", "PP")] }, { tables });
  assert.match(open, /ขั้นตอนนี้รอ: <strong>แผนก RB \(.+ และอีก 2 คน\) \/ PP ตอบภายใน/, "an open department lists its staff and managers (first three names); a department nobody can answer for shows only its code");
  const named = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1")] }, { tables });
  assert.match(named, /แผนก RB \(ผู้ตอบที่ระบุ: สมชาย ทดสอบ\) ตอบภายใน/);
});

test("part 2 lists the named responders only when somebody is named", async () => {
  const shown = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1"), responsibility("dept-gr", "GR")] });
  assert.match(shown, /<\/svg>ผู้ตอบที่ระบุ<\/dt><dd>RB: ผู้ทดสอบ<\/dd>/, "only the department that names a responder is listed");
  const hidden = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] });
  assert.doesNotMatch(hidden, /<\/svg>ผู้ตอบที่ระบุ<\/dt>/);
});

// ฟอร์มจำลองที่ bindDetail ผูก submit handler ให้ — checked = ช่องที่ติ๊ก, selects = ช่องเลือกผู้ตอบ [departmentId]: value, fields = ช่องข้อความ
function fakeForm(action, { dataset = {}, checked = {}, selects = {}, fields = {} } = {}) {
  return {
    dataset: { action, ...dataset }, fields, elements: {},
    addEventListener(type, handler) { if (type === "submit") this.submit = handler; },
    reportValidity: () => true,
    querySelectorAll: (selector) => {
      const name = selector.match(/^input\[name="(.+)"\]:checked$/)?.[1];
      return name ? (checked[name] ?? []).map((value) => ({ value })) : [];
    },
    querySelector: (selector) => {
      const id = selector.match(/^\[data-responder-dept="(.+)"\] select$/)?.[1];
      return id && id in selects ? { value: selects[id] } : null;
    },
  };
}

test("the disposition sends p_responder_ids only for ticked departments with a named person", async () => {
  const send = async (form) => {
    const { rpcCalls } = await renderPage(FACTORY_MANAGER, { status: "awaiting_disposition", ncr_responsibilities: [] }, { forms: [form], tables: { departments: DEPARTMENTS } });
    await form.submit({ preventDefault() {} });
    return rpcCalls.find((call) => call.name === "app_ncr_dispose");
  };
  const checked = { dispositions: ["sort"], department_ids: ["dept-rb", "dept-gr"] };
  const named = await send(fakeForm("dispose", { checked, selects: { "dept-rb": "s1", "dept-gr": "", "dept-pp": "ignored" } }));
  assert.deepEqual(named.args.p_responder_ids, ["s1"], "unticked and empty pickers are left out");
  assert.deepEqual(named.args.p_department_ids, ["dept-rb", "dept-gr"]);
  const none = await send(fakeForm("dispose", { checked, selects: { "dept-rb": "", "dept-gr": "" } }));
  assert.equal("p_responder_ids" in none.args, false, "nobody named: the parameter is omitted so the call also works before the migration");
  const unticked = await send(fakeForm("dispose", { checked: { dispositions: ["sort"], department_ids: ["dept-gr"] }, selects: { "dept-rb": "s1" } }));
  assert.equal("p_responder_ids" in unticked.args, false, "a picker whose department is not ticked is ignored");
});

test("changing the responder sends the department and null when the choice is cleared", async () => {
  const named = [responsibility("dept-rb", "RB", "s1")];
  const send = async (fields) => {
    const form = fakeForm("assign_responder", { dataset: { departmentId: "dept-rb" }, fields });
    const { rpcCalls } = await renderPage(FACTORY_MANAGER, { id: "ncr-1", status: "awaiting_response", ncr_responsibilities: named }, { forms: [form], tables: { employees: ROSTER } });
    await form.submit({ preventDefault() {} });
    return rpcCalls.find((call) => call.name === "app_ncr_assign_responder");
  };
  assert.deepEqual((await send({ responder: "m1" })).args, { p_ncr_id: "ncr-1", p_department_id: "dept-rb", p_responder_id: "m1" });
  assert.equal((await send({ responder: "" })).args.p_responder_id, null, "an empty choice clears the named responder");
});
