import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import test from "node:test";
const require = createRequire(import.meta.url);
const model = require("../../modules/qc-model.js");

// ตัวอย่างจริงจากฟอร์ม QA01-PM11
test("computeItem judges against the spec like private.qc_judge", () => {
  const a = model.computeItem({ points: [9.13, 8.95, 9.27, 9.21, 9.15], spec_min: 12, spec_max: 14 });
  assert.deepEqual(a, { min: 8.95, max: 9.27, avg: 9.142, judge: "N" });
  assert.equal(model.computeItem({ points: [64, 65, 64, 62, 64], spec_min: 65, spec_max: 75 }).judge, "N");
  assert.equal(model.computeItem({ points: [1.2, 1.3], spec_min: null, spec_max: null }).judge, "NA", "no spec = not judged");
  assert.equal(model.computeItem({ points: [66, 70, 75, 65, 71], spec_min: 65, spec_max: 75 }).judge, "O", "the limits themselves are in spec");
  assert.equal(model.computeItem({ points: [5, 6], spec_min: 5, spec_max: null }).judge, "O", "an open side is not checked");
  assert.equal(model.computeItem({ points: [5, 9], spec_min: null, spec_max: 8 }).judge, "N");
});

test("computeItem reads form strings, skips blanks and rounds the average to 4 places", () => {
  const item = model.computeItem({ points: ["1", "2", "", "2"], spec_min: "0", spec_max: "5" });
  assert.deepEqual(item, { min: 1, max: 2, avg: 1.6667, judge: "O" });
  assert.deepEqual(model.computeItem({ points: [] }), { min: null, max: null, avg: null, judge: null });
  assert.deepEqual(model.computeItem({ points: ["", "abc"], spec_min: 1 }), { min: null, max: null, avg: null, judge: null });
  assert.equal(model.round4(-1.00005), -1.0001, "halves round away from zero like numeric rounding");
});

test("computeResult follows the report rule: any N is ng, otherwise any AC is accept", () => {
  assert.equal(model.computeResult(["O", "O", "NA"]), "ok");
  assert.equal(model.computeResult(["O", "AC"]), "accept");
  assert.equal(model.computeResult(["AC", "N"]), "ng");
  assert.equal(model.computeResult([{ judge: "O" }, { judge: "N" }]), "ng");
  assert.equal(model.computeResult([]), null);
  assert.equal(model.computeResult([null]), null);
});

test("labels and badge classes", () => {
  assert.equal(model.STATUS_LABELS.pending_qa_manager, "รอ ผจก.QA");
  assert.equal(model.RESULT_LABELS.accept, "ยอมรับ (Accept)");
  for (const status of ["pending_qa_manager", "pending_factory_manager", "pending_general_manager"]) assert.equal(model.statusBadgeClass(status), "pending_approval");
  assert.equal(model.statusBadgeClass("approved"), "completed");
  assert.equal(model.statusBadgeClass("rejected"), "rejected");
  assert.equal(model.statusBadgeClass("cancelled"), "rejected");
  assert.equal(model.statusBadgeClass("draft"), "in_progress");
  assert.equal(model.JUDGE_CLASSES.AC, "qc-judge-ac");
});

const specs = [
  { item_no: "A", name: "ความหนา", instrument: "Caliper", unit: "mm", spec_min: 12, spec_std: 13, spec_max: 14 },
  { item_no: "D", name: "รูปร่าง", instrument: "", unit: "", spec_min: null, spec_std: null, spec_max: null },
];
const form = (change = {}) => ({
  template_id: "tpl-1", part_number: "P-100", part_name: "ยางรอง", customer: "ลูกค้า", order_no: "SO-1", code: "C1", sample_label: "2M",
  inspected_at: "2026-10-27T09:30", remark: "ok", compound_lots: ["L1"],
  items: [{ item_no: "A", points: ["9.13", "8.95", "", ""], note: "", accept: false }, { item_no: "D", points: ["1"], note: "" }],
  ...change,
});

test("reportPayload builds the RPC payload with Bangkok time and numeric points", () => {
  const { payload, error } = model.reportPayload(form(), specs);
  assert.equal(error, undefined);
  assert.equal(payload.inspected_at, "2026-10-27T09:30:00+07:00");
  assert.equal(payload.template_id, "tpl-1");
  assert.deepEqual(payload.compound_lots, ["L1"]);
  assert.deepEqual(payload.items[0].points, [9.13, 8.95]);
  assert.equal(payload.items[0].spec_min, 12);
  assert.equal(payload.items[1].spec_min, null);
  assert.equal("judge_override" in payload.items[0], false);
  assert.equal("id" in payload, false);
  const edit = model.reportPayload(form({ id: "r1", version: "3" }), specs).payload;
  assert.equal(edit.id, "r1");
  assert.equal(edit.version, 3);
});

test("reportPayload sends AC only for an N item with a note of 5+ characters", () => {
  const accepted = (note, points = ["9"]) => model.reportPayload(form({ items: [{ item_no: "A", points, note, accept: true }, { item_no: "D", points: ["1"] }] }), specs);
  assert.match(accepted("").error, /ยอมรับ \(AC\).*หมายเหตุ/);
  assert.match(accepted("abcd").error, /อย่างน้อย 5/);
  assert.equal(accepted("ลูกค้าอนุโลม").payload.items[0].judge_override, "AC");
  assert.equal("judge_override" in accepted("", ["13"]).payload.items[0], false, "an item that passes the spec needs no acceptance");
});

test("reportPayload rejects bad input with a Thai message", () => {
  const fails = (change, pattern, items = specs) => assert.match(model.reportPayload(form(change), items).error, pattern);
  fails({ part_number: "x".repeat(61) }, /Part Number/);
  fails({ part_name: " " }, /Part Name/);
  fails({ remark: "x".repeat(2001) }, /REMARK/);
  fails({ compound_lots: Array.from({ length: 11 }, (_, i) => `L${i}`) }, /ไม่เกิน 10/);
  fails({ compound_lots: ["L1", "L1"] }, /ซ้ำ/);
  fails({ compound_lots: ["x".repeat(61)] }, /1–60/);
  fails({ inspected_at: "not a date" }, /วันที่ตรวจ/);
  fails({ items: [{ item_no: "A", points: ["abc"] }, { item_no: "D", points: ["1"] }] }, /ตัวเลข/);
  fails({ items: [{ item_no: "A", points: ["1", "", "3"] }, { item_no: "D", points: ["1"] }] }, /ไม่เว้นช่อง/);
  fails({ items: [{ item_no: "A", points: ["", ""] }, { item_no: "D", points: ["1"] }] }, /อย่างน้อย 1 จุด/);
  fails({ items: [{ item_no: "A", points: ["1", "2", "3", "4", "5", "6"] }, { item_no: "D", points: ["1"] }] }, /ไม่เกิน 5/);
  fails({ items: [{ item_no: "A", points: ["1"] }, { item_no: "D", points: ["1"], note: "x".repeat(501) }] }, /500/);
  fails({ id: "r1", version: "x" }, /version/);
  fails({}, /อย่างน้อย 1 รายการ/, []);
  fails({}, /MIN ต้องไม่เกิน MAX/, [{ ...specs[0], spec_min: 20 }, specs[1]]);
  fails({}, /สเปกต้องเป็นตัวเลข/, [{ ...specs[0], spec_max: "abc" }, specs[1]]);
});

test("the part number is optional but the part name is not", () => {
  for (const part_number of ["", "   ", undefined, null]) {
    const { payload, error } = model.reportPayload(form({ part_number }), specs);
    assert.equal(error, undefined, `report with part_number ${JSON.stringify(part_number)}`);
    assert.equal(payload.part_number, "", "an empty part number is sent as an empty string");
  }
  assert.equal(model.reportPayload(form({ part_number: "x".repeat(60) }), specs).error, undefined, "sixty characters is the limit");
  assert.match(model.reportPayload(form({ part_number: "", part_name: "" }), specs).error, /Part Name/);
  const rows = [{ item_no: "A", name: "ความหนา", instrument: "", unit: "", spec_min: "", spec_std: "", spec_max: "", points_required: "" }];
  const template = model.templatePayload({ part_number: "  ", part_name: "ชิ้นเดี่ยว", items: rows });
  assert.equal(template.error, undefined);
  assert.equal(template.payload.part_number, "");
  assert.match(model.templatePayload({ part_name: "", items: rows }).error, /Part Name/);
  assert.equal(model.partNumberText(""), "-");
  assert.equal(model.partNumberText(" P-1 "), "P-1");
  assert.equal(model.partNumberText(null), "-");
  assert.equal(model.partLabel("P-1", "ยางรอง"), "P-1 · ยางรอง");
  assert.equal(model.partLabel("", "ยางรอง"), "ยางรอง", "the part name alone labels a part without a number");
  assert.equal(model.partLabel(null, "ยางรอง"), "ยางรอง");
});

test("templatePayload validates the template rows", () => {
  const rows = [
    { item_no: " a ", name: "ความหนา", instrument: "Caliper", unit: "mm", spec_min: "12", spec_std: "13", spec_max: "14", points_required: "" },
    { item_no: "B", name: "สี", instrument: "", unit: "", spec_min: "", spec_std: "", spec_max: "", points_required: "3" },
  ];
  const { payload, error } = model.templatePayload({ part_number: "P-100", part_name: "ยางรอง", customer: "", drawing_note: "", status: "", items: rows });
  assert.equal(error, undefined);
  assert.equal(payload.status, "active");
  assert.equal(payload.items[0].item_no, "A", "item numbers are upper-cased");
  assert.equal(payload.items[0].points_required, 5, "default 5 points");
  assert.equal(payload.items[1].points_required, 3);
  assert.equal(payload.items[1].spec_min, null);
  assert.equal(model.templatePayload({ id: "t1", version: 2, part_number: "P", part_name: "N", items: rows }).payload.version, 2);
  const bad = (change, pattern) => assert.match(model.templatePayload({ part_number: "P", part_name: "N", items: rows, ...change }).error, pattern);
  bad({ part_number: "x".repeat(61) }, /Part Number/);
  bad({ part_name: " " }, /Part Name/);
  bad({ status: "deleted" }, /สถานะ/);
  bad({ items: [] }, /อย่างน้อย 1 รายการ/);
  bad({ items: [{ ...rows[0], item_no: "1" }] }, /ITEM No/);
  bad({ items: [rows[0], { ...rows[1], item_no: "A" }] }, /ซ้ำ/);
  bad({ items: [{ ...rows[0], name: "" }] }, /ชื่อรายการ/);
  bad({ items: [{ ...rows[0], spec_min: "20" }] }, /MIN ต้องไม่เกิน MAX/);
  bad({ items: [{ ...rows[0], spec_std: "x" }] }, /ตัวเลข/);
  bad({ items: [{ ...rows[0], points_required: "6" }] }, /1–5/);
  bad({ items: [{ ...rows[0], points_required: "2.5" }] }, /จำนวนเต็ม/);
  bad({ items: Array.from({ length: 31 }, (_, i) => ({ ...rows[0], item_no: `A${String.fromCharCode(65 + (i % 26))}` })) }, /ไม่เกิน 30/);
});

test("ncrArgs follows the NCR issue rules", () => {
  const ok = { qty_total: "100", qty_defect: "5", unit: "ชิ้น", defect_type_code: "DIM", description: "ค่าความหนาต่ำกว่าสเปก" };
  assert.deepEqual(model.ncrArgs(ok).args, { p_defect_type_code: "DIM", p_qty_total: 100, p_qty_defect: 5, p_unit: "ชิ้น", p_description: "ค่าความหนาต่ำกว่าสเปก" });
  assert.match(model.ncrArgs({ ...ok, qty_total: "0" }).error, /จำนวนที่ตรวจ/);
  assert.match(model.ncrArgs({ ...ok, qty_defect: "" }).error, /จำนวนเสีย/);
  assert.match(model.ncrArgs({ ...ok, qty_defect: "101" }).error, /ไม่เกิน/);
  assert.match(model.ncrArgs({ ...ok, unit: "กล่อง" }).error, /หน่วย/);
  assert.match(model.ncrArgs({ ...ok, defect_type_code: "" }).error, /ประเภทข้อบกพร่อง/);
  assert.match(model.ncrArgs({ ...ok, description: "สั้น" }).error, /10–4,000/);
});

const report = {
  id: "9f0c2f52-1111-4222-8333-444455556666", report_no: "TEST-QC-26-001", status: "pending_factory_manager", result: "ng", part_number: "P-100", part_name: "ยางรอง",
  customer: "ลูกค้า", order_no: "SO-1", code: "C1", sample_label: "2M", compound_lots: ["L1", "L2"], inspected_by: "e1", inspected_at: "2026-10-27T02:30:00+00:00",
  inspector_name: "สมชาย ใจดี", inspector: { first_name: "สมชาย", last_name: "ใจดี" }, remark: "=cmd", ncr_no: null,
  updated_at: "2026-10-27T03:00:00+00:00",
  approvals: [
    { step_order: 1, step_code: "qa_manager", status: "approved", first_name: "สมหญิง", last_name: "ตั้งใจ", acted_at: "2026-10-27T03:00:00+00:00", comment: "" },
    { step_order: 2, step_code: "factory_manager", status: "pending", first_name: null, last_name: null, acted_at: null, comment: "" },
    { step_order: 3, step_code: "general_manager", status: "pending", first_name: null, last_name: null, acted_at: null, comment: "" },
  ],
  items: [{ item_no: "A", name: "ความหนา", instrument: "Caliper", unit: "mm", spec_min: 12, spec_std: 13, spec_max: 14, points: [9.13, 8.95], point_min: 8.95, point_max: 9.13, point_avg: 9.04, judge: "N", note: "" }],
};

test("buildSheetRecord flattens a report for the spreadsheet copy", () => {
  const record = model.buildSheetRecord(report);
  assert.equal(record.reportNo, "TEST-QC-26-001");
  assert.equal(record.isTest, true);
  assert.equal(record.statusLabel, "รอ ผจก.โรงงาน");
  assert.equal(record.resultLabel, "ไม่ผ่าน (Reject)");
  assert.equal(record.lots, "L1, L2");
  assert.equal(record.inspector, "สมชาย ใจดี");
  assert.equal(record.inspectedAt, "2026-10-27 09:30", "Bangkok time");
  assert.deepEqual(record.approvals.qa, { status: "approved", name: "สมหญิง ตั้งใจ", date: "2026-10-27 10:00", comment: "" });
  assert.deepEqual(record.approvals.factory, { status: "pending", name: "", date: "", comment: "" });
  assert.deepEqual(record.items[0], { itemNo: "A", name: "ความหนา", instrument: "Caliper", unit: "mm", specMin: 12, specStd: 13, specMax: 14, points: [9.13, 8.95], min: 8.95, max: 9.13, avg: 9.04, judge: "N", note: "" });
  assert.equal(record.ncrNo, "");
  assert.equal(model.buildSheetRecord({ ...report, report_no: "QC-26-001" }).isTest, false);
  assert.equal(model.buildSheetRecord(report, { nameOf: (person) => `K ${person.first_name}` }).inspector, "K สมชาย");
});

test("buildSheetRecord leaves an empty part number empty (the Apps Script draws the dash)", () => {
  assert.equal(model.buildSheetRecord({ ...report, part_number: "" }).partNumber, "");
  assert.equal(model.buildSheetRecord({ ...report, part_number: null }).partNumber, "");
  assert.equal(model.buildSheetRecord(report).partNumber, "P-100");
});

test("buildFormExport asks the Apps Script to draw the QA01-PM11 form", () => {
  const payload = model.buildFormExport(report);
  assert.equal(payload.form, "qc");
  assert.equal(payload.fileName, "TEST-QC-26-001.xlsx");
  assert.equal(payload.record.reportNo, "TEST-QC-26-001");
  assert.equal(model.buildFormExport({ ...report, report_no: "../x y" }).fileName, "-x-y.xlsx");
  assert.equal(model.buildFormExport({ ...report, report_no: "" }).fileName, "QA01-PM11.xlsx");
});

const migration = new URL("../../supabase/migrations/20261027010000_qc_inspection_reports.sql", import.meta.url);
test("every QC error code the migration can raise has a Thai message", { skip: !fs.existsSync(migration) && "the QC migration is not in this checkout" }, () => {
  const sql = fs.readFileSync(migration, "utf8");
  const codes = [...new Set([...sql.matchAll(/raise exception '(QC_[A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(codes.length >= 20, `found ${codes.length} codes`);
  for (const code of codes) assert.ok(model.ERROR_MESSAGES[code], `${code} has no message`);
});

test("friendlyError picks the intended message: no key is hidden by an earlier key that is a part of it", () => {
  const keys = Object.keys(model.ERROR_MESSAGES);
  for (const key of keys) {
    // friendlyError (app.js) takes the first key contained in the message
    assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
    assert.notEqual(key, "NOT_AUTHORIZED");
    assert.ok(!key.includes("NOT_AUTHORIZED"), "the shared NOT_AUTHORIZED message is not overridden");
  }
});
