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

async function renderFor(viewer, overrides = {}) {
  const report = { ...NCR, ...overrides };
  const app = { innerHTML: "" };
  const query = (table) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      maybeSingle: async () => ({ data: table === "ncr_reports" ? report : null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return builder;
  };
  const noop = () => {};
  const context = {
    app, console, Intl, Date, Map, Set, Promise, URLSearchParams,
    state: { employee: viewer },
    sb: { from: query, rpc: async () => ({ data: null, error: null }) },
    shell: (content) => content, bindShell: noop, loadingShell: noop, showToast: noop, friendlyError: String, setFormBusy: noop,
    escapeHtml, formatDate: (value) => String(value ?? "—"), relation: (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null),
    loadEmployeeDirectory: async () => new Map(), personName: () => "ผู้ทดสอบ",
    DEPT_MANAGER_ROLE_CODES: ["department_manager", "assistant_department_manager"],
    optionalAttachments: () => [], uploadAttachmentBatch: async () => ({ total: 0, failed: [] }), attachmentBatchFailureText: () => "",
    attachmentGalleryHtml: () => "", hydrateAttachmentGallery: async () => {}, openAttachmentLightbox: noop,
    document: { querySelector: () => null, querySelectorAll: () => [] },
  };
  context.window = context;
  context.window.MNP_NCR_ATTACHMENTS = { fieldHtml: () => "", bucket: () => "ncr-attachments", uploadOne: async () => {} };
  context.window.MNP_NCR_SHEET_SYNC = { sync: noop, buildRecord: () => ({}) };
  vm.createContext(context);
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  await context.window.MNP_REQUEST_MODULES.NCR_CAR.pages.ncr(new URLSearchParams({ id: report.id }));
  return app.innerHTML;
}

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

test("the card layout does not depend on test mode or on the report's mode", async () => {
  for (const isSandbox of [false, true]) {
    for (const isTest of [false, true]) {
      const html = await renderFor(employee("emp-fm", "dept-ft", "FT", "factory_manager", isSandbox), { is_test: isTest });
      for (const part of [1, 2, 3, 4]) assert.match(html, new RegExp(`ncr-detail-part--${part}`), `sandbox=${isSandbox} test report=${isTest}: part ${part}`);
      assert.match(html, /ncr-quantity-summary/, `sandbox=${isSandbox} test report=${isTest}: quantity summary`);
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
});

test("the disposition form states the 5-day response window the database sets", async () => {
  const html = await renderFor(employee("e1", "dept-ft", "FT", "factory_manager"), { status: "awaiting_disposition" });
  assert.match(html, /บันทึกและส่งแผนก \(ตอบภายใน 5 วัน\)/);
  assert.doesNotMatch(html, /ตอบภายใน 7 วัน/);
});
