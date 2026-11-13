import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลด modules/module-ncr.js พร้อม ncr-costs.js / ncr-loss-form.js เข้า context จำลองที่มีฟังก์ชันของ app.js แบบ stub
// แล้ววาดหน้ารายละเอียด NCR ของพนักงานจริง (ไม่ใช่โหมดทดสอบ) ตรวจ HTML: การ์ดส่วนที่ 1–4 แบบใหม่ และใครเห็นฟอร์มความสูญเสีย
// (ต้องตรงกับ private.can_edit_ncr_losses — ฐานข้อมูลเป็นตัวตัดสินสิทธิ์จริง ดู supabase/tests/database/ncr_loss_editors_same_in_all_modes.test.sql)
const FILES = ["modules/form-steps.js", "modules/ncr-costs.js", "modules/ncr-loss-form.js", "modules/module-ncr.js"];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const employee = (id, deptId, deptCode, roleCode, isSandbox = false) => ({ id, department_id: deptId, department: { code: deptCode }, role: { code: roleCode }, isSandbox });

const NCR = {
  id: "ncr-1", ncr_no: "QA041/26", form_code: "QA02-FM01", status: "closed", is_test: false, product_name: "ท่อยาง", product_code: "P-1", unit: "ท่อน",
  issue_date: "2026-10-01", reporter_id: "emp-reporter", reporter_department: { code: "RB" }, source: "in_process", defect_type: { name_th: "ขนาดผิด" },
  description: "รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm", qty_total: 100, qty_sampled: 20, qty_defect: 5, qty_returned: 0,
  dispositions: ["sort"], causes: ["machine"], response_due: "2026-10-06", root_cause: "เครื่องสึก", correction: "คัดแยก", prevention: "ซ่อมบำรุง",
  followed_up_at: "2026-10-08",
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
      select: () => builder, eq: () => builder, order: () => builder, in: () => builder, lt: () => builder, is: () => builder, limit: () => builder,
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
    // การ์ดประวัติเอกสารชิ้นเดียวของ app.js (historyCardHtml)
    headingTextHtml: (text) => String(text ?? ""),
    historyCardHtml: (items, foot = "") => `<section class="card detail-history"><h2>ประวัติเอกสาร</h2><div class="timeline">${items}</div>${foot}</section>`,
    // ตัวช่วยทะเบียนของ app.js (registerTableHtml ฯลฯ) แบบย่อ: ตรวจว่าทะเบียน NCR ส่งช่องครบ ไม่ใช่หน้าตา
    registerTableHtml: ({ columns, rows }) => `<table>${rows.map((row) => `<tr>${columns.map((column) => `<td data-label="${column.label}">${row.cells[column.key] ?? ""}</td>`).join("")}</tr>`).join("")}</table>`,
    registerNoHtml: (number, href) => `<a href="${href}">${number}</a>`, registerSubHtml: (text) => `<span class="register-sub">${text}</span>`, uiIcon: () => "", registerSubjectHtml: (main, href, secondary) => `${main}|${secondary}`,
    hrefSelectHtml: ({ options, value }) => `<select>${options.map((option) => `<option data-href="${option.href}"${option.value === value ? " selected" : ""}>${option.label}</option>`).join("")}</select>`, uiIcon: () => "",
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fields?.[name] ?? null; } },
    confirmDialog: async () => true,
    document: {
      // MNP_FORM_STEPS.showFieldErrors สร้างข้อความผิดด้วย createElement
      createElement: () => ({ dataset: {} }),
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
  await context.window.MNP_REQUEST_MODULES.NCR_CAR.pages.ncr(options.params ?? new URLSearchParams({ id: report.id }));
  return { html: app.innerHTML, rpcCalls, context };
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

// ---- รอบยุบหน้า (distill): งานที่ต้องทำขึ้นก่อน, ไม่แสดงส่วนที่ยังว่าง, ไม่พูดซ้ำ ----
const EMPTY_PARTS = { status: "awaiting_response", responded_at: null, root_cause: null, correction: null, prevention: null, followed_up_at: null, closed_at: null };

test("the action the viewer must take comes first, before the four parts and the evidence", async () => {
  const html = await renderFor(employee("emp-rb", "dept-rb", "RB", "staff"), EMPTY_PARTS);
  const action = html.indexOf("ncr-actions");
  assert.ok(action > 0, "the respond form is shown");
  assert.ok(action < html.indexOf("ncr-detail-part--1"), "the action panel is above part 1");
  assert.ok(html.indexOf("ncr-detail-part--1") < html.indexOf("ไฟล์หลักฐาน"), "evidence stays below the parts");
  assert.match(html, /<section class="card ncr-card ncr-actions" data-module="ncr">/);
});

test("parts 3 and 4 that nobody has filled yet are not drawn, and appear once they hold data", async () => {
  const early = await renderFor(employee("emp-qa", "dept-qa", "QA", "staff"), EMPTY_PARTS);
  assert.match(early, /ncr-detail-part--1/);
  assert.match(early, /ncr-detail-part--2/);
  assert.doesNotMatch(early, /ncr-detail-part--3/, "part 3 has nothing yet");
  assert.doesNotMatch(early, /ncr-detail-part--4/, "part 4 has nothing yet");
  const answered = await renderFor(employee("emp-qa", "dept-qa", "QA", "staff"), { ...EMPTY_PARTS, status: "awaiting_followup", responded_at: "2026-10-04", root_cause: "เครื่องสึก" });
  assert.match(answered, /ncr-detail-part--3/);
  assert.doesNotMatch(answered, /ncr-detail-part--4/);
  const signed = await renderFor(employee("emp-qa", "dept-qa", "QA", "staff"), { ...EMPTY_PARTS, status: "awaiting_signoff", responded_at: "2026-10-04", root_cause: "เครื่องสึก", followed_up_at: "2026-10-08" });
  assert.match(signed, /ncr-detail-part--4/);
});

test("every part of the NCR wears the one NCR palette, and the page keeps one link back to the register (the breadcrumb is plain text)", async () => {
  const html = await renderFor(employee("emp-qa", "dept-qa", "QA", "staff"));
  const parts = html.match(/<section class="card ncr-card ncr-detail-part ncr-detail-part--\d" data-module="ncr"/g) ?? [];
  assert.equal(parts.length, 4);
  // ลิงก์ย้อนกลับแบบเดียวกับหน้ารายละเอียดคำร้อง (request-back-link เหนือหัว): #/ncr คือหน้า NCR/CAR ของศูนย์คำร้อง
  // รอบ 15: shell ย้ายลิงก์นี้ขึ้นแถบบน (แทนป้ายทางเดิน) ลิงก์จึงบอกชื่อปลายทางเอง
  assert.equal((html.match(/<a class="request-back-link" href="#\/ncr">‹ NCR\/CAR<\/a>/g) ?? []).length, 1, "one way back for browser users who opened the NCR from a link");
  assert.doesNotMatch(html, /class="btn secondary" href="#\/ncr">‹/, "not a second back button inside the heading");
  assert.doesNotMatch(html, /style="/, "no inline colours");
});

test("the cost summary is one line, and the unconfirmed amounts are folded into a details element", async () => {
  const loss = { id: "l1", ncr_id: NCR.id, entry_kind: "loss", loss_type: "scrap", cost_status: "estimated", amount: 1200, quantity: 10, unit: "pcs", unit_cost: 120, recorded_by: "e1", recorded_at: "2026-11-01" };
  const html = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"), {}, { tables: { ncr_losses: [loss] } });
  assert.equal((html.match(/<dl class="ncr-loss-summary/g) ?? []).length, 1);
  assert.match(html, /<dt>สุทธิยืนยันแล้ว<\/dt>/);
  assert.match(html, /<details class="ncr-loss-more"><summary>ยอดที่ยังไม่ยืนยัน<\/summary><dl class="ncr-loss-pending">/);
  assert.doesNotMatch(html.replace(/<details class="ncr-loss-more">[\s\S]*?<\/details>/, ""), /ncr-loss-pending/, "the pending tiles live only inside the details");
});

test("before the first loss row there are no 0.00 tiles, and 'not assessed yet' is said once", async () => {
  const editor = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"));
  assert.doesNotMatch(editor, /สุทธิยืนยันแล้ว|ncr-loss-more/, "editor: no zero tiles, only the live preview of the row being entered");
  assert.match(editor, /id="ncr-loss-preview"/);
  const viewer = await renderFor(employee("e8", "dept-qa", "QA", "staff"));
  assert.equal((viewer.match(/ยังไม่มีรายการความสูญเสีย/g) ?? []).length, 1, "the empty state is said once");
  assert.doesNotMatch(viewer, /กรุณาประเมินก่อนสรุป/, "a viewer who cannot enter costs is not asked to assess them");
  assert.doesNotMatch(viewer, /<dl class="ncr-loss-summary/);
  assert.doesNotMatch(viewer, /ประเมินความสูญเสียยังไม่ครบ/, "the review block below already says the costs are not confirmed");
  // รอบ 17: คำเดียว "ความสูญเสีย" และผู้ยืนยันยอด (ผู้ใช้เลือก 2026-11-12)
  assert.equal((viewer.match(/ยังไม่ได้ยืนยันว่าประเมินความสูญเสียครบ/g) ?? []).length, 1);
  assert.doesNotMatch(viewer, /ค่าเสียหาย|ผู้กรอกต้นทุน/);
  // แถวที่ยกเลิกแล้วยังแสดงในตาราง ช่องสรุปจึงยังแสดง ไม่บอกว่า "ยังไม่มีรายการ"
  const voided = { id: "l9", ncr_id: NCR.id, entry_kind: "loss", loss_type: "scrap", cost_status: "estimated", amount: 500, quantity: 1, unit: "pcs", unit_cost: 500, recorded_by: "e1", recorded_at: "2026-11-01", voided_at: "2026-11-02", void_reason: "ซ้ำ" };
  const withVoided = await renderFor(employee("e8", "dept-qa", "QA", "staff"), {}, { tables: { ncr_losses: [voided] } });
  assert.doesNotMatch(withVoided, /ยังไม่มีรายการความสูญเสีย/);
  assert.match(withVoided, /<dl class="ncr-loss-summary/);
});

test("the upload hint (file types and size) is shown once on the detail page, in the evidence section", () => {
  const source = fs.readFileSync("modules/module-ncr.js", "utf8");
  const calls = [...source.matchAll(/evidenceFieldHtml\("(ncr-[a-z-]+-evidence)".*\)/g)].map((match) => match[0]);
  assert.ok(calls.length >= 8, "the NCR forms use the shared evidence field");
  for (const call of calls) {
    // ฟอร์มออก NCR (หน้าของมันเอง) และช่องแนบเพิ่มใน "ไฟล์หลักฐาน" แสดงคำอธิบาย ฟอร์มของขั้นตอนไม่แสดงซ้ำ
    if (/ncr-issue-evidence|ncr-attach-evidence/.test(call)) assert.doesNotMatch(call, /hint: false/, call);
    else assert.match(call, /hint: false/, call);
  }
  assert.match(fs.readFileSync("modules/ncr-loss-form.js", "utf8"), /evidenceFieldHtml\?\.\(id, "แนบไฟล์เพิ่มเติม \(ถ้ามี\)", \{ hint: false \}\)/);
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

test("who sees the loss form on a real NCR matches app_ncr_record_loss (cost editors, and the NCR's responders for estimates)", async () => {
  // NCR ใบนี้ให้แผนก RB รับผิดชอบ — ผู้ตอบของ RB ใส่ยอดประมาณการได้ (migration 20261115010000) ส่วนแผนกอื่นไม่ได้
  const cases = [
    ["factory manager", employee("e1", "dept-ft", "FT", "factory_manager"), true],
    ["assistant factory manager", employee("e2", "dept-ft", "FT", "assistant_factory_manager"), true],
    ["general manager", employee("e3", "dept-mgt", "MGT", "general_manager"), true],
    ["QA department manager", employee("e9", "dept-qa", "QA", "department_manager"), true],
    ["QA assistant department manager", employee("e10", "dept-qa", "QA", "assistant_department_manager"), true],
    ["manager of the responsible department", employee("e4", "dept-rb", "RB", "department_manager"), true],
    ["assistant manager of the responsible department", employee("e5", "dept-rb", "RB", "assistant_department_manager"), true],
    ["manager of another department", employee("e6", "dept-pk", "PK", "department_manager"), false],
    ["staff of the responsible department", employee("e7", "dept-rb", "RB", "staff"), true],
    ["QA staff", employee("e8", "dept-qa", "QA", "staff"), false],
  ];
  for (const [label, viewer, editable] of cases) {
    const html = await renderFor(viewer);
    assert.equal(html.includes('id="ncr-loss-form"'), editable, `${label}: loss form ${editable ? "shown" : "hidden"}`);
  }
});

test("an admin account counts as its working role for the loss form", async () => {
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
});

test("the general manager sign-off step counts an admin's working role; the earlier steps keep real roles", async () => {
  // ตรงกับ app_ncr_signoff / app_ncr_request_info ใน migration 20261102010000
  const admin = (id, deptId, deptCode, actingRoleCode) => ({ ...employee(id, deptId, deptCode, "admin"), actingRole: actingRoleCode ? { code: actingRoleCode } : null });
  const awaitingGm = { status: "awaiting_signoff", signoff_qa_at: "2026-10-10", signoff_factory_at: "2026-10-11" };
  const awaitingFactory = { status: "awaiting_signoff", signoff_qa_at: "2026-10-10", signoff_factory_at: null };
  const awaitingQa = { status: "awaiting_signoff", signoff_qa_at: null, signoff_factory_at: null };
  const cases = [
    ["admin working as general manager at the GM step", admin("a1", "dept-mgt", "MGT", "general_manager"), awaitingGm, true],
    ["real general manager at the GM step", employee("e3", "dept-mgt", "MGT", "general_manager"), awaitingGm, true],
    ["admin without a working role at the GM step", admin("a7", "dept-mgt", "MGT", null), awaitingGm, false],
    ["admin working as factory manager at the GM step", admin("a3", "dept-ft", "FT", "factory_manager"), awaitingGm, false],
    ["admin working as factory manager at the factory step", admin("a3", "dept-ft", "FT", "factory_manager"), awaitingFactory, false],
    ["admin in QA working as department manager at the QA step", admin("a4", "dept-qa", "QA", "department_manager"), awaitingQa, false],
    ["admin working as general manager at the factory step", admin("a1", "dept-mgt", "MGT", "general_manager"), awaitingFactory, false],
  ];
  for (const [label, viewer, overrides, canSign] of cases) {
    const html = await renderFor(viewer, overrides);
    assert.equal(/data-action="signoff"/.test(html), canSign, `${label}: sign-off ${canSign ? "shown" : "hidden"}`);
    assert.equal(/data-action="request_info"/.test(html), canSign, `${label}: request info ${canSign ? "shown" : "hidden"}`);
  }
});

test("the waiting text names the admin working as general manager at the GM step", async () => {
  // loadNcrStaff แปลง acting_role_id เป็น actingRole จากตาราง roles (ไม่มี foreign key จึง embed ไม่ได้) — ตรงกับ private.ncr_audience
  const tables = {
    roles: [{ id: "role-gm", code: "general_manager" }, { id: "role-fm", code: "factory_manager" }],
    employees: [
      { id: "a1", first_name: "ฟาง", last_name: "ผู้ดูแล", department_id: "dept-mgt", acting_role_id: "role-gm", role: { code: "admin" }, department: { code: "MGT" } },
      { id: "a7", first_name: "ไอที", last_name: "ผู้ดูแล", department_id: "dept-it", acting_role_id: null, role: { code: "admin" }, department: { code: "IT" } },
      { id: "a3", first_name: "รอง", last_name: "ผู้ดูแล", department_id: "dept-ft", acting_role_id: "role-fm", role: { code: "admin" }, department: { code: "FT" } },
    ],
  };
  const viewer = employee("emp-qa", "dept-qa", "QA", "staff");
  const html = await renderFor(viewer, { status: "awaiting_signoff", signoff_qa_at: "2026-10-10", signoff_factory_at: "2026-10-11" }, { tables });
  assert.match(html, /ผู้จัดการทั่วไป \(ฟาง ผู้ดูแล\)/);
  assert.doesNotMatch(html, /ไอที ผู้ดูแล/);
  // ขั้น ผจก.โรงงานยังดู role จริง: admin ที่ตั้งบทบาทหลักเป็น ผจก.โรงงานไม่ถูกระบุชื่อ
  const factoryHtml = await renderFor(viewer, { status: "awaiting_signoff", signoff_qa_at: "2026-10-10", signoff_factory_at: null }, { tables });
  assert.doesNotMatch(factoryHtml, /รอง ผู้ดูแล/);
});

test("a cancelled NCR locks the loss form for everyone, and the responsible department decides who enters estimates", async () => {
  const factoryManager = employee("e1", "dept-ft", "FT", "factory_manager");
  const qaManager = employee("e9", "dept-qa", "QA", "department_manager");
  for (const viewer of [factoryManager, qaManager]) {
    assert.equal((await renderFor(viewer, { status: "cancelled" })).includes('id="ncr-loss-form"'), false, "cancelled report: form hidden");
  }
  const qaResponsible = { ncr_responsibilities: [{ share: 100, department_id: "dept-qa", department: { code: "QA", name_th: "QA" } }] };
  assert.equal((await renderFor(qaManager, qaResponsible)).includes('id="ncr-loss-form"'), true, "QA manager, QA responsible: form shown");
  assert.equal((await renderFor(qaManager)).includes('id="ncr-loss-form"'), true, "QA manager, QA not responsible: form shown");
  assert.equal((await renderFor(employee("e8", "dept-qa", "QA", "staff"), qaResponsible)).includes('id="ncr-loss-form"'), true, "QA staff when QA is responsible: estimate form");
  assert.equal((await renderFor(employee("e8", "dept-qa", "QA", "staff"))).includes('id="ncr-loss-form"'), false, "QA staff when QA is not responsible: form hidden");
  assert.equal((await renderFor(employee("e4", "dept-rb", "RB", "department_manager"), { status: "cancelled" })).includes('id="ncr-loss-form"'), false, "responsible department on a cancelled report: form hidden");
});

test("the NCR's responders enter and edit estimates only: no confirm, void or cost review", async () => {
  const estimate = { id: "l1", ncr_id: NCR.id, entry_kind: "loss", loss_type: "scrap", component: "quantity", cost_status: "estimated", amount: 60, quantity: 2, unit: "ชิ้น", unit_cost: 30, recorded_by: "e7", recorded_at: "2026-11-01" };
  const confirmed = { ...estimate, id: "l2", cost_status: "confirmed", evidence_ref: "SC-1" };
  const responder = await renderFor(employee("e7", "dept-rb", "RB", "staff"), {}, { tables: { ncr_losses: [estimate, confirmed] } });
  assert.match(responder, /<input type="hidden" name="cost_status" value="estimated">/, "the status is fixed to an estimate");
  assert.doesNotMatch(responder, /id="ncr-loss-status"/, "no estimate/confirmed choice");
  assert.equal((responder.match(/data-edit-loss="/g) ?? []).length, 1, "only the estimated line can be edited");
  assert.match(responder, /data-edit-loss="l1">แก้ไขยอดประมาณการ</);
  assert.doesNotMatch(responder, /data-void-loss=/, "no void buttons");
  assert.doesNotMatch(responder, /data-action="review_costs"/, "no cost review form");
  const editor = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"), {}, { tables: { ncr_losses: [estimate, confirmed] } });
  assert.match(editor, /id="ncr-loss-status"/);
  assert.equal((editor.match(/data-void-loss="/g) ?? []).length, 2);
  assert.match(editor, /data-action="review_costs"/);
  // ผจก.โรงงานระบุผู้ตอบของแผนกไว้แล้ว: พนักงานคนอื่นในแผนกไม่ได้ฟอร์ม
  const named = { ncr_responsibilities: [{ share: 100, department_id: "dept-rb", responder_id: "e4", department: { code: "RB", name_th: "ขึ้นรูปยาง" } }] };
  assert.equal((await renderFor(employee("e7", "dept-rb", "RB", "staff"), named)).includes('id="ncr-loss-form"'), false, "another staff member once a responder is named");
  assert.equal((await renderFor(employee("e4", "dept-rb", "RB", "department_manager"), named)).includes('id="ncr-loss-form"'), true, "the named responder");
});

test("read-only viewers are told who can enter costs; editors are not", async () => {
  const readOnly = await renderFor(employee("e8", "dept-qa", "QA", "staff"));
  // ชื่อตำแหน่งเต็มในข้อความ (ผู้ใช้เลือก 2026-11-10)
  // รอบ 17: พับไว้ใต้ "ใครกรอกความสูญเสียได้" ไม่เป็นย่อหน้าถาวร · ชื่อผู้ยืนยันยอด
  assert.match(readOnly, /<details class="ncr-loss-who"><summary>ใครกรอกความสูญเสียได้<\/summary><p class="muted small">ผู้ยืนยันยอด: ผู้จัดการทั่วไป ผู้จัดการโรงงาน ผู้ช่วยผู้จัดการโรงงาน และผู้จัดการ\/ผู้ช่วยผู้จัดการแผนก QA/);
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
  assert.match(rb, /<option value="m1">มานะ ทดสอบ · ผู้จัดการแผนก<\/option>/);
  assert.match(picker("dept-gr"), /อารี ทดสอบ · ผู้ช่วยผู้จัดการแผนก/);
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
  assert.match(open, /ขั้นตอนนี้รอ: <strong>แผนก RB \(.+ และอีก 2 คน\) · แผนก PP ตอบภายใน/, "an open department lists its staff and managers (first three names); a department nobody can answer for shows only its code");
  const named = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1")] }, { tables });
  // รอบ 13: ใครต้องทำต่อแบบเดียว "แผนก X (ชื่อ)" ทุกแผนก · ผู้ตอบที่ระบุบอกในส่วนที่ 2
  assert.match(named, /แผนก RB \(สมชาย ทดสอบ · ผู้ตอบที่ระบุ\) ตอบภายใน/);
});

test("part 2 does not repeat the named responder and the due date that the waiting line already gives", async () => {
  const tables = { employees: [...ROSTER] };
  const page = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1")] }, { tables });
  assert.match(page, /ขั้นตอนนี้รอ: <strong>แผนก RB \(สมชาย ทดสอบ · ผู้ตอบที่ระบุ\) ตอบภายใน/);
  assert.doesNotMatch(page, /<\/svg>ผู้ตอบที่ระบุ<\/dt>/, "the waiting line names the responder");
  assert.doesNotMatch(page, /<\/svg>กำหนดตอบ<\/dt>/, "the waiting line gives the due date");
  // ผู้ตอบที่ระบุไม่อยู่ในรายชื่อที่ใช้งานอยู่: บรรทัดรอบอกแค่ "(ผู้ตอบที่ระบุ)" ส่วนที่ 2 จึงยังบอกชื่อ
  const missing = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s-gone")] }, { tables });
  assert.match(missing, /แผนก RB \(ผู้ตอบที่ระบุ\) ตอบภายใน/);
  assert.match(missing, /<\/svg>ผู้ตอบที่ระบุ<\/dt>/);
});

test("part 2 lists the named responders only when somebody is named", async () => {
  const shown = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB", "s1"), responsibility("dept-gr", "GR")] });
  assert.match(shown, /<\/svg>ผู้ตอบที่ระบุ<\/dt><dd>RB: ผู้ทดสอบ<\/dd>/, "only the department that names a responder is listed");
  const hidden = await renderFor(QA_STAFF, { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] });
  assert.doesNotMatch(hidden, /<\/svg>ผู้ตอบที่ระบุ<\/dt>/);
});

// ฟอร์มจำลองที่ bindDetail ผูก submit handler ให้ — checked = ช่องที่ติ๊ก, selects = ช่องเลือกผู้ตอบ [departmentId]: value, fields = ช่องข้อความ
// shown = ข้อความผิดที่ MNP_FORM_STEPS แสดงใต้ช่อง (ชื่อช่อง → ข้อความ) · scrolledTo = ช่องที่หน้าเลื่อนไปหา · handlers = listener ทุกชนิดที่ผูกกับฟอร์ม
function fakeForm(action, { dataset = {}, checked = {}, selects = {}, fields = {} } = {}) {
  const form = {
    dataset: { action, ...dataset }, fields, elements: {}, shown: {}, scrolledTo: [], handlers: {},
    addEventListener(type, handler) { form.handlers[type] = handler; if (type === "submit") form.submit = handler; },
    querySelectorAll: (selector) => {
      const name = selector.match(/^input\[name="(.+)"\]:checked$/)?.[1];
      return name ? (checked[name] ?? []).map((value) => ({ value })) : [];
    },
    querySelector: (selector) => {
      const id = selector.match(/^\[data-responder-dept="(.+)"\] select$/)?.[1];
      if (id) return id in selects ? { value: selects[id] } : null;
      const field = selector.match(/^\[data-field="(.+)"\]$/)?.[1];
      if (!field) return null;
      return {
        append: (node) => { form.shown[field] = node.textContent; },
        querySelector: (inner) => (inner === ".field-error[data-generated]" && field in form.shown ? { remove: () => { delete form.shown[field]; } } : null),
        querySelectorAll: () => [],
        scrollIntoView: () => form.scrolledTo.push(field),
      };
    },
  };
  return form;
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

test("the NCR register lists each report as one table row with every column filled, and the category is a select", async () => {
  // ทะเบียน NCR ใช้ตารางชุดเดียวกับรายการคำร้อง (registerTableHtml ใน app.js) — สถานะที่ยังไม่ปิดมีชื่อผู้รับผิดชอบใต้สถานะ
  const open = { ...NCR, status: "awaiting_response", customer_name: "บริษัท ทดสอบ" };
  const { html } = await renderPage(employee("emp-qa", "dept-qa", "QA", "staff"), {}, { params: new URLSearchParams(), tables: { ncr_reports: [open] } });
  const has = (text, message) => assert.ok(html.includes(text), message ?? text);
  has('<a href="#/ncr?id=ncr-1">QA041/26</a>');
  has('<td data-label="สินค้า/วัตถุดิบ">ท่อยาง|บริษัท ทดสอบ</td>');
  has('<td data-label="ข้อบกพร่อง">ขนาดผิด · 5 ท่อน</td>');
  has('<td data-label="แผนกรับผิดชอบ">RB</td>');
  has('<td data-label="วันที่ออก">2026-10-01</td>');
  has('<option data-href="#/ncr?status=open" selected>ยังไม่ปิด</option>', "the category filter is one select, open by default");
  assert.doesNotMatch(html, /request-timeline-card|class="filters"/, "no card feed or chip row left");
});

test("the NCR issue form's own quantity rules match app_ncr_issue: they reject what it rejects and accept what it accepts", async () => {
  // กติกาจริงจาก module-ncr.js (shared.ISSUE_RULES) ตรวจกับ validate() จริงของ form-steps.js — ตรงกับ 20261002020000_ncr_phase1.sql
  const { context } = await renderPage(employee("emp-qa", "dept-qa", "QA", "staff"));
  const rules = context.window.MNP_REQUEST_MODULES.NCR_CAR.shared.ISSUE_RULES.filter((rule) => rule.name.startsWith("qty_"));
  // Array.from: array จาก vm เป็นคนละ realm deepStrictEqual จึงเทียบ prototype ไม่ผ่าน
  const failing = (values) => Array.from(context.window.MNP_FORM_STEPS.validate(rules, { qty_sampled: "", qty_returned: "", ...values }), (error) => error.name);
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "10" }), [], "defect equal to the total is allowed");
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "10.5" }), ["qty_defect"], "more defects than the total is rejected");
  assert.deepEqual(failing({ qty_total: "1,000", qty_defect: "5", qty_sampled: "50", qty_returned: "0" }), [], "thousands separators and zero returned pass");
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "5", qty_sampled: "0" }), ["qty_sampled"], "a sample of 0 is rejected like the database does");
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "5", qty_returned: "-1" }), ["qty_returned"]);
  assert.deepEqual(failing({ qty_total: "0.0004", qty_defect: "0.0001" }), ["qty_total", "qty_defect"], "values that round to 0 in numeric(14,3) are rejected");
  assert.deepEqual(failing({ qty_total: "100000000000", qty_defect: "5" }), ["qty_total"], "a total too big for numeric(14,3) is rejected");
  assert.deepEqual(failing({ qty_total: "", qty_defect: "5" }), ["qty_total"], "without a total only the total is reported");
  // ฐานข้อมูลเทียบทั้งค่าดิบ (ในฟังก์ชัน) และค่าที่ปัดเก็บ (CHECK ของตาราง): ฟอร์มต้องปฏิเสธทั้งสองทาง
  assert.deepEqual(failing({ qty_total: "99999999999.9996", qty_defect: "5" }), ["qty_total"], "rounds up past numeric(14,3)");
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "5", qty_returned: "-0.0004" }), ["qty_returned"], "negative before rounding");
  assert.deepEqual(failing({ qty_total: "10.0003", qty_defect: "10.0004" }), ["qty_defect"], "above the total before rounding");
  assert.deepEqual(failing({ qty_total: "10", qty_defect: "5", qty_returned: "-0" }), [], "-0 is zero for the database too");
});

test("the home page lists an open NCR for whoever the detail page gives that step's form, and the reporter's own open NCRs", async () => {
  // กฎเดียวกับ actionForms: ผจก.โรงงานพิจารณา · ผู้ตอบของแผนกตอบ/ส่งแนวทางป้องกัน/ให้ข้อมูลเพิ่ม · QA ติดตามผล · ผู้ลงนามลำดับถัดไปลงนาม
  const responsibilities = (responderId = null) => [{ department_id: "dept-rb", responder_id: responderId }];
  const open = (status, extra = {}) => ({ id: `ncr-${status}`, status, reporter_id: "emp-reporter", prevention: null, signoff_qa_at: null, signoff_factory_at: null, response_due: "2999-01-01", ncr_responsibilities: responsibilities(), ...extra });
  const rows = [
    open("awaiting_disposition", { ncr_responsibilities: [] }),
    open("awaiting_response"),
    open("awaiting_followup"),
    open("awaiting_signoff", { signoff_qa_at: "2026-10-10" }),
    open("awaiting_info", { ncr_responsibilities: responsibilities("emp-rb-named") }),
    open("awaiting_response", { id: "ncr-mine", reporter_id: "emp-rb-staff", ncr_responsibilities: [{ department_id: "dept-mt", responder_id: null }] }),
  ];
  const { context } = await renderPage(employee("emp-qa", "dept-qa", "QA", "staff"), {}, { tables: { ncr_reports: rows } });
  const home = context.window.MNP_REQUEST_MODULES.NCR_CAR.home;
  const tasksOf = (viewer) => rows.map((row) => [row.id, home.task(row, viewer)]).filter(([, task]) => task);
  const asPlain = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(asPlain(tasksOf(employee("emp-fm", "dept-rb", "RB", "factory_manager"))), [["ncr-awaiting_disposition", "พิจารณา NCR"], ["ncr-awaiting_signoff", "ลงนามปิด"]]);
  assert.deepEqual(asPlain(tasksOf(employee("emp-rb-staff", "dept-rb", "RB", "staff"))), [["ncr-awaiting_response", "ตอบ NCR"], ["ncr-awaiting_followup", "ส่งแนวทางป้องกัน"]],
    "a named responder (awaiting_info) shuts out the rest of the department");
  assert.deepEqual(asPlain(tasksOf(employee("emp-rb-named", "dept-rb", "RB", "staff"))).map(([id]) => id), ["ncr-awaiting_response", "ncr-awaiting_followup", "ncr-awaiting_info"]);
  assert.deepEqual(asPlain(tasksOf(employee("emp-qa", "dept-qa", "QA", "staff"))), [["ncr-awaiting_followup", "ติดตามผล"]], "QA staff follow up but do not sign");
  assert.deepEqual(asPlain(tasksOf(employee("emp-qa-mgr", "dept-qa", "QA", "department_manager"))), [["ncr-awaiting_followup", "ติดตามผล"]], "the QA signature is already on the NCR waiting for signoff");
  assert.deepEqual(asPlain(tasksOf(employee("emp-sup", "dept-rb", "RB", "supervisor"))), [], "a supervisor is not a responder");
  const qaFirst = open("awaiting_signoff");
  assert.equal(home.task(qaFirst, employee("emp-qa-mgr", "dept-qa", "QA", "department_manager")), "ลงนามปิด", "the QA manager signs first");
  assert.equal(home.task(qaFirst, employee("emp-qa-asst", "dept-qa", "QA", "assistant_department_manager")), "ลงนามปิด", "so does the assistant QA manager");
  assert.equal(home.task(qaFirst, employee("emp-qa", "dept-qa", "QA", "staff")), null, "QA staff do not sign");
  assert.equal(home.task(qaFirst, employee("emp-fm", "dept-rb", "RB", "factory_manager")), null, "the factory manager waits for QA");
  assert.equal(home.task(rows[0], employee("emp-afm", "dept-rb", "RB", "assistant_factory_manager")), null, "only the factory manager disposes");
  assert.equal(home.task(rows[1], employee("emp-rb-asst", "dept-rb", "RB", "assistant_department_manager")), "ตอบ NCR", "an assistant manager of the department can respond");
  assert.equal(home.task({ ...rows[2], prevention: "ตรวจแม่พิมพ์" }, employee("emp-rb-staff", "dept-rb", "RB", "staff")), null, "prevention already sent: nothing left for the department");
  assert.equal(home.task(rows[3], { ...employee("emp-admin", "dept-it", "IT", "admin"), actingRole: { code: "general_manager" } }), null, "the general manager signs only after the factory manager");
  assert.equal(home.task({ ...rows[3], signoff_factory_at: "2026-10-11" }, { ...employee("emp-admin", "dept-it", "IT", "admin"), actingRole: { code: "general_manager" } }), "ลงนามปิด");

  // NCR ที่ถึงขั้นของผู้ใช้อยู่ใน tasks ส่วนที่ผู้ใช้ออกเองและยังไม่ถึงขั้นของเขาอยู่ใน mine (ไม่ซ้ำกัน)
  const loaded = asPlain(await home.load(employee("emp-rb-staff", "dept-rb", "RB", "staff")));
  assert.deepEqual(loaded.tasks.map((item) => [item.ncr.id, item.task, item.overdue]), [["ncr-awaiting_response", "ตอบ NCR", false], ["ncr-awaiting_followup", "ส่งแนวทางป้องกัน", false]]);
  assert.deepEqual(loaded.mine.map((ncr) => ncr.id), ["ncr-mine"]);
  const overdue = asPlain(await home.load(employee("emp-fm", "dept-rb", "RB", "factory_manager")));
  assert.equal(overdue.tasks[0].overdue, false);
  rows[0].response_due = "2000-01-01";
  assert.equal(asPlain(await home.load(employee("emp-fm", "dept-rb", "RB", "factory_manager"))).tasks[0].overdue, true, "past the response date while still waiting for the factory manager");
  rows.length = 0;
  assert.deepEqual(asPlain(await home.load(employee("emp-fm", "dept-rb", "RB", "factory_manager"))), { tasks: [], mine: [] }, "no open NCR: nothing to add");
});

// ฟอร์มตอบ NCR: บอกเหลือ/เลยกี่วัน (วันกำหนดตอบอยู่ในส่วนที่ 2 และป้ายหัวใบแล้ว) กับวันส่งแนวทางป้องกัน
test("the respond form says how many days are left or late, and when prevention is due", async () => {
  const open = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] };
  const late = await renderFor(RB_STAFF_1, { ...open, response_due: "2026-01-05" });
  assert.match(late, /<p class="ncr-due-note">เลยกำหนดตอบ <strong>\d+ วัน<\/strong> · ส่งแนวทางป้องกันไม่ให้เกิดซ้ำภายใน <strong>2026-01-12<\/strong><\/p>/);
  assert.doesNotMatch(late, /ตอบภายใน 5 วัน/, "no rule text that reads as if the NCR were on time");
  const early = await renderFor(RB_STAFF_1, { ...open, response_due: "2099-01-05" });
  assert.match(early, /<p class="ncr-due-note">เหลือเวลาตอบ <strong>\d+ วัน<\/strong> · ส่งแนวทางป้องกันไม่ให้เกิดซ้ำภายใน <strong>2099-01-12<\/strong><\/p>/);
});

// ผู้ตอบที่ใส่ได้แค่ประมาณการ (#331) ไม่เห็นคำขอของผู้กรอกต้นทุน · ผู้กรอกต้นทุนยังเห็นครบ
test("the responder's estimate-only loss form asks nothing that only the cost editors can do", async () => {
  const open = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] };
  const responder = await renderFor(RB_STAFF_1, open);
  assert.match(responder, /ใส่ยอดประมาณการได้หลายรายการ/, "the responder has the estimate-only form");
  assert.doesNotMatch(responder, /กรุณาประเมินก่อนสรุปว่าไม่มีความสูญเสีย/);
  assert.match(responder, /หลักฐานอ้างอิง \(ถ้ามี\)/);
  assert.match(responder, /ผู้ยืนยันยอดยังไม่ได้ยืนยันว่าประเมินความสูญเสียครบ/, "the review status names who still has to act");
  const editor = await renderFor(FACTORY_MANAGER, open);
  assert.match(editor, /กรุณาประเมินก่อนสรุปว่าไม่มีความสูญเสีย/);
  assert.match(editor, /หลักฐานอ้างอิง \(จำเป็นเมื่อยืนยันยอด\)/);
  // รอบ 13: ช่อง "ประเมินค่าเสียหายครบแล้ว" ที่ยังไม่ติ๊กบอกสถานะเอง ไม่มีบรรทัดซ้ำกับป้ายบนหัวใบ
  assert.doesNotMatch(editor, /<p class="muted">ยังไม่ได้ยืนยันว่าประเมินความสูญเสียครบ<\/p>/);
});

// ทางแนบไฟล์ (pointToStepFiles ใน app.js): ซ่อนช่องอัปโหลดแยกเฉพาะเมื่อมีฟอร์มของขั้นที่แนบหลักฐานได้ เลือกด้วยชื่อการกระทำ ไม่ใช่ตำแหน่ง
test("only a step form that carries evidence replaces the separate uploader; cancel, sign-off and info-request forms never do", async () => {
  const open = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] };
  const actionsOf = (html) => {
    const section = html.slice(html.indexOf('class="card ncr-card ncr-actions"'));
    return [...section.slice(0, section.indexOf("</section>")).matchAll(/<form class="ncr-action" data-action="([a-z_]+)"/g)].map((match) => match[1]);
  };
  const input = { type: "file" };
  const formsFor = (actions, withFile = true) => actions.map((action) => ({ dataset: { action }, querySelector: () => (withFile ? input : null) }));
  const { context, html: qaManager } = await renderPage(employee("qm", "dept-qa", "QA", "department_manager"), open);
  const { stepFileInput } = context.window.MNP_REQUEST_MODULES.NCR_CAR.shared;
  // รอบ 10: ผู้กรอกต้นทุนเห็นฟอร์มค่าเสียหายในการ์ดงานเดียวกันขณะยังรอข้อมูลความสูญเสีย — ไม่ใช่ฟอร์มของขั้น จึงไม่แทนช่องอัปโหลดแยก
  assert.deepEqual(actionsOf(qaManager), ["cancel", "add_loss", "review_costs"], "the QA manager who is not the responder has the cancel form and the loss forms here");
  assert.equal(stepFileInput(formsFor(actionsOf(qaManager))), null, "so the separate uploader stays: attaching must never mean cancelling the NCR");
  assert.equal(stepFileInput(formsFor(actionsOf(await renderFor(RB_STAFF_1, open)))), input, "the responder attaches with the answer");
  assert.equal(stepFileInput(formsFor(actionsOf(await renderFor(FACTORY_MANAGER, { status: "awaiting_disposition" })))), input, "the factory manager attaches with the disposition");
  assert.equal(stepFileInput(formsFor(["signoff", "request_info", "cancel"])), null, "signers keep the separate uploader");
  assert.equal(stepFileInput(formsFor(["respond"], false)), null, "a step form without a file field changes nothing");
});

// ---- ตรวจช่องก่อนเรียก RPC: ข้อความใต้ช่องทุกช่องครั้งเดียว แบบเดียวกับฟอร์ม MT (MNP_FORM_STEPS) ----
const QA_MANAGER = employee("qm", "dept-qa", "QA", "department_manager");
const RB_OPEN = { status: "awaiting_response", ncr_responsibilities: [responsibility("dept-rb", "RB")] };
const NCR_RPC = /^app_ncr_/;

// วาดหน้า แล้วส่งฟอร์มจำลอง: คืน rpc ที่ถูกเรียกกับฟอร์ม (form.shown = ข้อความผิดที่แสดงอยู่)
async function submitForm(viewer, overrides, form, options = {}) {
  const { rpcCalls } = await renderPage(viewer, overrides, { forms: [form], ...options });
  await form.submit({ preventDefault() {} });
  return rpcCalls.filter((call) => NCR_RPC.test(call.name));
}

test("the action forms mark required fields with (จำเป็น) like the MT forms, never with an asterisk", async () => {
  const pages = [
    [FACTORY_MANAGER, { status: "awaiting_disposition", ncr_responsibilities: [] }, { tables: { departments: DEPARTMENTS } }],
    [RB_STAFF_1, RB_OPEN, {}],
    [RB_STAFF_1, { status: "awaiting_followup", prevention: null, prevention_due: "2026-10-13", ncr_responsibilities: RB_OPEN.ncr_responsibilities }, {}],
    [QA_STAFF, { status: "awaiting_followup" }, {}],
    [QA_MANAGER, { status: "awaiting_signoff", signoff_qa_at: null }, {}],
    [RB_STAFF_1, { status: "awaiting_info", ncr_responsibilities: RB_OPEN.ncr_responsibilities }, {}],
  ];
  const seen = new Set();
  for (const [viewer, overrides, options] of pages) {
    const html = await renderFor(viewer, overrides, options);
    assert.doesNotMatch(html, /\S \*(?=[\s<])/, `no asterisk marker on ${overrides.status}`);
    for (const match of html.matchAll(/<form class="ncr-action" data-action="([a-z_]+)"/g)) seen.add(match[1]);
  }
  for (const action of ["dispose", "respond", "submit_prevention", "followup", "request_info", "answer_info", "cancel"]) assert.ok(seen.has(action), `${action} form was rendered`);
  const page = await renderFor(RB_STAFF_1, RB_OPEN);
  const respond = page.slice(page.indexOf('data-action="respond"'), page.indexOf("</form>", page.indexOf('data-action="respond"')));
  assert.equal((respond.match(/<span class="field-required">\(จำเป็น\)<\/span>/g) ?? []).length, 3, "cause, root cause and correction are marked");
  assert.match(respond, /แนวทางการป้องกันไม่ให้เกิดซ้ำ \(ถ้ามี\)<\/label>[^]*?<small>ส่งภายหลังได้หลังวิเคราะห์เสร็จ<\/small>/, "the prevention field is marked optional like every form and says it can come later");
  // ช่องที่ตรวจใต้ช่องต้องมีกล่อง data-field ให้ข้อความไปอยู่
  for (const name of ["causes", "root_cause", "correction", "prevention"]) assert.match(respond, new RegExp(`data-field="${name}"`));
  assert.match(page, /<form class="ncr-action" data-action="respond" novalidate>/, "browser tooltips are off so the field messages are the only ones");
  const loss = await renderFor(FACTORY_MANAGER, { status: "awaiting_response" });
  assert.doesNotMatch(loss, /\S \*(?=[\s<])/, "the loss form has no asterisk either");
  assert.ok((loss.match(/\(จำเป็น\)/g) ?? []).length >= 8, "the loss form marks its required fields");
});

test("an incomplete respond form makes no RPC call and reports every missing field at once", async () => {
  const form = fakeForm("respond", { fields: { prevention: "abc" } });
  const calls = await submitForm(RB_STAFF_1, RB_OPEN, form);
  assert.deepEqual(calls, [], "nothing is sent to the database");
  assert.deepEqual(Object.keys(form.shown), ["causes", "root_cause", "correction", "prevention"], "all fields, in screen order");
  assert.match(form.shown.causes, /อย่างน้อย 1 ข้อ/);
  assert.match(form.shown.prevention, /อย่างน้อย 5 ตัวอักษร/, "a too-short optional prevention is reported");
  assert.deepEqual(form.scrolledTo, ["causes"], "the page scrolls to the first missing field");
  // แก้ช่องไหน ข้อความของช่องนั้นหายเอง ช่องอื่นยังอยู่
  form.handlers.input({ target: { closest: () => ({ dataset: { field: "root_cause" } }) } });
  assert.deepEqual(Object.keys(form.shown), ["causes", "correction", "prevention"]);
});

test("a too-short root cause or correction is rejected, an empty optional prevention is not", async () => {
  const form = fakeForm("respond", { checked: { causes: ["machine"] }, fields: { root_cause: " abcd ", correction: "12345" } });
  assert.deepEqual(await submitForm(RB_STAFF_1, RB_OPEN, form), []);
  assert.deepEqual(Object.keys(form.shown), ["root_cause"], "5 characters after trimming, like app_ncr_respond");
});

test("a complete respond form still sends the same arguments", async () => {
  const form = fakeForm("respond", { checked: { causes: ["machine", "method"] }, fields: { root_cause: "เครื่องสึก", correction: "เปลี่ยนแม่พิมพ์" } });
  const calls = await submitForm(RB_STAFF_1, RB_OPEN, form);
  assert.deepEqual(calls, [{ name: "app_ncr_respond", args: { p_ncr_id: "ncr-1", p_causes: ["machine", "method"], p_root_cause: "เครื่องสึก", p_correction: "เปลี่ยนแม่พิมพ์", p_prevention: "" } }]);
  assert.deepEqual(form.shown, {});
});

test("an incomplete disposition reports the missing method and department; a complete one still sends", async () => {
  const awaiting = { status: "awaiting_disposition", ncr_responsibilities: [] };
  const options = { tables: { departments: DEPARTMENTS } };
  const empty = fakeForm("dispose");
  assert.deepEqual(await submitForm(FACTORY_MANAGER, awaiting, empty, options), []);
  assert.deepEqual(Object.keys(empty.shown), ["dispositions", "department_ids"]);
  const noDepartment = fakeForm("dispose", { checked: { dispositions: ["sort"] } });
  assert.deepEqual(await submitForm(FACTORY_MANAGER, awaiting, noDepartment, options), []);
  assert.deepEqual(Object.keys(noDepartment.shown), ["department_ids"], "only what is missing is reported");
  const complete = fakeForm("dispose", { checked: { dispositions: ["sort"], department_ids: ["dept-rb"] }, fields: { note: "คัดแยก 100%" } });
  assert.deepEqual(await submitForm(FACTORY_MANAGER, awaiting, complete, options), [{ name: "app_ncr_dispose", args: { p_ncr_id: "ncr-1", p_dispositions: ["sort"], p_department_ids: ["dept-rb"], p_note: "คัดแยก 100%" } }]);
});

test("the follow-up needs a result, and a note of 3 characters when the NCR is sent back", async () => {
  const awaiting = { status: "awaiting_followup" };
  const none = fakeForm("followup");
  assert.deepEqual(await submitForm(QA_STAFF, awaiting, none), []);
  assert.deepEqual(Object.keys(none.shown), ["result"], "the note is only required for a return");
  const noNote = fakeForm("followup", { checked: { result: ["return"] }, fields: { note: "ab" } });
  assert.deepEqual(await submitForm(QA_STAFF, awaiting, noNote), []);
  assert.deepEqual(Object.keys(noNote.shown), ["note"]);
  // เปลี่ยนผลติดตามแล้วข้อความของบันทึกที่ผูกกับผลนั้นหายด้วย
  noNote.handlers.change({ target: { closest: () => ({ dataset: { field: "result" } }) } });
  assert.deepEqual(noNote.shown, {});
  const close = fakeForm("followup", { checked: { result: ["close"] } });
  assert.deepEqual(await submitForm(QA_STAFF, awaiting, close), [{ name: "app_ncr_followup", args: { p_ncr_id: "ncr-1", p_result: "close", p_note: null } }]);
  const back = fakeForm("followup", { checked: { result: ["return"] }, fields: { note: "เพิ่มรูป" } });
  assert.deepEqual(await submitForm(QA_STAFF, awaiting, back), [{ name: "app_ncr_followup", args: { p_ncr_id: "ncr-1", p_result: "return", p_note: "เพิ่มรูป" } }]);
});

test("prevention, information request, answer and cancel reasons need 5 characters before any RPC call", async () => {
  const cases = [
    ["submit_prevention", RB_STAFF_1, { status: "awaiting_followup", prevention: null, prevention_due: "2026-10-13", ncr_responsibilities: RB_OPEN.ncr_responsibilities }, "prevention", "app_ncr_submit_prevention", (text) => ({ p_ncr_id: "ncr-1", p_prevention: text })],
    ["request_info", QA_MANAGER, { status: "awaiting_signoff", signoff_qa_at: null }, "note", "app_ncr_request_info", (text) => ({ p_ncr_id: "ncr-1", p_note: text })],
    ["answer_info", RB_STAFF_1, { status: "awaiting_info", ncr_responsibilities: RB_OPEN.ncr_responsibilities }, "note", "app_ncr_answer_info", (text) => ({ p_ncr_id: "ncr-1", p_note: text })],
    ["cancel", QA_MANAGER, RB_OPEN, "reason", "app_ncr_cancel", (text) => ({ p_ncr_id: "ncr-1", p_reason: text })],
  ];
  for (const [action, viewer, overrides, field, rpc, args] of cases) {
    for (const text of ["", "   ", "1234"]) {
      const form = fakeForm(action, { fields: { [field]: text } });
      assert.deepEqual(await submitForm(viewer, overrides, form), [], `${action}: "${text}" sends nothing`);
      assert.deepEqual(Object.keys(form.shown), [field], `${action}: the message is under the field`);
    }
    const ok = fakeForm(action, { fields: { [field]: " 12345 " } });
    assert.deepEqual(await submitForm(viewer, overrides, ok), [{ name: rpc, args: args("12345") }], `${action}: five characters go through, trimmed`);
  }
});

test("the loss form checks its fields against app_ncr_record_loss before sending", async () => {
  const { context } = await renderPage(FACTORY_MANAGER, { status: "awaiting_response" });
  const base = { entry_kind: "loss", loss_type: "scrap", component: "quantity", cost_status: "estimated", incurred_on: "2026-11-01", labor_headcount: "", labor_hours: "", quantity: "", unit: "ท่อน", unit_cost: "", evidence_ref: "", note: "" };
  const lossForm = (values, labor = false) => ({ elements: Object.fromEntries(Object.entries({ ...base, ...values }).map(([name, value]) => [name, { value, disabled: name.startsWith("labor_") && !labor }])) });
  const names = (values, labor) => Array.from(context.window.MNP_NCR_LOSS_UI.errors(lossForm(values, labor), "2026-11-10"), (error) => error.name);
  assert.deepEqual(names({}), ["quantity", "unit_cost"], "an empty entry reports every missing field at once");
  assert.deepEqual(names({ quantity: "10", unit_cost: "5" }), [], "a complete estimate passes");
  assert.deepEqual(names({ quantity: "0", unit_cost: "0" }), ["quantity"], "the quantity must be above 0, a zero cost is allowed");
  assert.deepEqual(names({ quantity: "10", unit_cost: "-1" }), ["unit_cost"]);
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", unit: " ", incurred_on: "" }), ["incurred_on", "unit"]);
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", cost_status: "confirmed" }), ["evidence_ref"], "a confirmed amount needs its evidence reference");
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", cost_status: "confirmed", evidence_ref: "INV-1", incurred_on: "2026-11-11" }), ["incurred_on"], "a confirmed amount cannot be dated in the future");
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", incurred_on: "2026-11-11" }), [], "an estimate may be");
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", loss_type: "other", component: "amount" }), ["note"], "'other' needs a description of at least 5 characters");
  assert.deepEqual(names({ quantity: "10", unit_cost: "5", note: "ab" }), [], "a short note is fine for other types");
  assert.deepEqual(names({ loss_type: "repair", component: "labor", unit_cost: "50" }, true), ["labor_headcount", "labor_hours"], "labour is checked through headcount and hours, not the computed quantity");
  assert.deepEqual(names({ loss_type: "repair", component: "labor", unit_cost: "50", labor_headcount: "2", labor_hours: "25" }, true), ["labor_hours"]);
  assert.deepEqual(names({ loss_type: "repair", component: "labor", unit_cost: "50", labor_headcount: "2", labor_hours: "3" }, true), []);
});

// รอบ 23 (critique P1): ฟอร์มขั้นที่พิมพ์ยาวเก็บร่างบนเครื่อง ต่อใบ ต่อผู้ใช้ ต่อการกระทำ แบบเดียวกับฟอร์มออก NCR
test("long step forms keep a local draft: respond, submit prevention and answer info", async () => {
  const { context } = await renderPage(employee("emp-rb", "dept-rb", "RB", "staff"));
  const memory = new Map();
  context.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key), get length() { return memory.size; }, key: (index) => [...memory.keys()][index] ?? null };
  context.setTimeout = (callback) => { callback(); return 0; };
  context.clearTimeout = () => {};
  vm.runInContext(fs.readFileSync("modules/form-draft.js", "utf8"), context, { filename: "modules/form-draft.js" });
  const { stepDraftValues, restoreStepDraft, bindStepDraft, STEP_DRAFT_ACTIONS } = context.window.MNP_REQUEST_MODULES.NCR_CAR.shared;
  assert.deepEqual([...STEP_DRAFT_ACTIONS], ["respond", "submit_prevention", "answer_info"]);
  const draftForm = (action, values = {}) => {
    const banner = { hidden: true, innerHTML: "", listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, removeEventListener() {}, contains: () => false };
    return {
      dataset: { action },
      elements: [
        { name: "causes", type: "checkbox", value: "man", checked: Boolean(values.man) },
        { name: "causes", type: "checkbox", value: "machine", checked: false },
        { name: "root_cause", type: "textarea", value: values.root_cause ?? "" },
        { name: "evidence", type: "file", value: "C:\fakepath\a.jpg" },
        { name: "", type: "submit", value: "" },
      ],
      listeners: {},
      addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
      removeEventListener() {},
      insertAdjacentHTML(position, html) { this.inserted = html; },
      querySelector: (selector) => (selector === ".draft-banner" ? banner : null),
      banner,
    };
  };
  const filled = draftForm("respond", { man: true, root_cause: "ใบมีดสึก" });
  assert.deepEqual(JSON.parse(JSON.stringify(stepDraftValues(filled))), { causes: ["man"], root_cause: "ใบมีดสึก" }, "files and buttons are never stored");
  assert.equal(bindStepDraft(draftForm("cancel"), "ncr-1", "emp-rb"), null, "short forms (cancel, sign-off) keep no draft");

  const first = bindStepDraft(filled, "ncr-1", "emp-rb");
  filled.listeners.input.forEach((handler) => handler({}));
  const key = "mnp-draft:NCR_STEP:respond:ncr-1:emp-rb";
  assert.equal(JSON.parse(memory.get(key)).values.root_cause, "ใบมีดสึก", "typing saves the draft for this NCR, user and action");

  // เปิดหน้าใหม่ (ฟอร์มว่าง) แล้วเลือกใช้ร่างต่อ
  const reopened = draftForm("respond");
  bindStepDraft(reopened, "ncr-1", "emp-rb");
  assert.match(reopened.inserted, /class="draft-banner"/);
  assert.equal(reopened.banner.hidden, false, "the banner offers the draft");
  reopened.banner.listeners.click({ target: { closest: () => ({ dataset: { draft: "use" } }) } });
  assert.equal(reopened.elements[2].value, "ใบมีดสึก");
  assert.equal(reopened.elements[0].checked, true);
  restoreStepDraft(reopened, { root_cause: "x" });
  assert.equal(reopened.elements[0].checked, true, "fields missing from a draft are left alone");

  first.clear();
  assert.equal(memory.has(key), false, "a successful submit clears the draft");
  const source = fs.readFileSync("modules/module-ncr.js", "utf8");
  assert.match(source, /if \(result\.error\) throw result\.error;\r?\n\s+stepDrafts\.get\(form\)\?\.clear\(\);/, "cleared only after the RPC succeeded");
});
