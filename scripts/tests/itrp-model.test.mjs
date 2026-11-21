import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// ส่วนข้อมูลล้วนของใบแจ้งซ่อมคอมพิวเตอร์ (modules/itrp-model.js): แท็บตามบทบาท ปุ่มตาม allowed_actions กติกาฟอร์มแจ้งซ่อม/ส่งงาน อะไหล่ เวลาซ่อม ลายเซ็นบนใบพิมพ์ ไฟล์ และ error
const require = createRequire(import.meta.url);
const model = require("../../modules/itrp-model.js");
require("../../modules/form-steps.js"); // MNP_FORM_STEPS.validate = ตัวตรวจฟอร์มจริงที่หน้าแจ้งซ่อม/ส่งงานใช้
const { validate } = globalThis.MNP_FORM_STEPS;

const plain = (value) => JSON.parse(JSON.stringify(value));
const params = (query) => new URLSearchParams(query);
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/* ---------- แท็บ / เส้นทาง ---------- */
test("every user gets 'ใบของฉัน'; approvals, IT work and settings follow my_role", () => {
  const keys = (role) => model.visibleTabs(role).map((tab) => tab.key);
  assert.deepEqual(keys({}), ["mine"]);
  assert.deepEqual(keys(null), ["mine"]);
  assert.deepEqual(keys({ is_dept_approver: true }), ["mine", "approvals"]);
  assert.deepEqual(keys({ is_it_approver: true }), ["mine", "approvals", "it"]);
  assert.deepEqual(keys({ is_it_admin: true }), ["mine", "it", "settings"]);
  assert.deepEqual(keys({ is_it_admin: true, is_it_approver: true }), ["mine", "approvals", "it", "settings"]);
});

test("a tab the user may not see is turned back, while detail/new/print pages are not tabs", () => {
  assert.equal(model.viewAllowed("mine", {}), true);
  for (const view of ["approvals", "it", "settings"]) assert.equal(model.viewAllowed(view, {}), false, view);
  assert.equal(model.viewAllowed("approvals", { is_dept_approver: true }), true);
  for (const view of ["new", "order", "print"]) assert.equal(model.viewAllowed(view, {}), true);
});

test("?view= picks the page and the repair URLs use module=repair", () => {
  assert.equal(model.readView(params("module=repair")), "mine");
  assert.equal(model.readView(null), "mine");
  for (const view of ["mine", "approvals", "it", "settings", "new", "order", "print"]) assert.equal(model.readView(params(`view=${view}`)), view);
  for (const view of ["bogus", "constructor", "__proto__"]) assert.equal(model.readView(params(`view=${view}`)), null);
  assert.equal(model.repairUrl(), "#/office?module=repair");
  assert.equal(model.repairUrl("new"), "#/office?module=repair&view=new");
  assert.equal(model.repairUrl("order", { id: "abc" }), "#/office?module=repair&view=order&id=abc");
  assert.equal(model.isUuid("2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10"), true);
  assert.equal(model.isUuid("nope"), false);
});

/* ---------- ตัวเลือกและป้ายไทย ---------- */
test("the four choice lists carry the owner's Thai labels in paper-form order", () => {
  assert.deepEqual(plain(model.REQUEST_KINDS), [
    { value: "repair", label: "ซ่อม" }, { value: "replace_part", label: "เปลี่ยนอะไหล่" }, { value: "inspect", label: "ตรวจเช็ค" }, { value: "install", label: "ติดตั้ง" }, { value: "other", label: "อื่นๆ" },
  ]);
  assert.deepEqual(plain(model.REPAIR_TARGETS).map((item) => item.label), ["เครื่องคอมพิวเตอร์", "อุปกรณ์", "อื่นๆ"]);
  assert.deepEqual(plain(model.CAUSE_KINDS).map((item) => item.label), ["การใช้งาน", "อะไหล่หมดอายุ", "อื่นๆ"]);
  assert.deepEqual(plain(model.REPAIR_METHODS), [
    { value: "internal", label: "ซ่อม-แก้ไขภายใน" }, { value: "external_onsite", label: "เรียกผู้ซ่อมจากภายนอก" }, { value: "sent_out", label: "ส่งซ่อมที่" },
  ]);
  for (const list of [model.REQUEST_KINDS, model.REPAIR_TARGETS, model.CAUSE_KINDS, model.REPAIR_METHODS]) assert.ok(Object.isFrozen(list));
  assert.equal(model.requestKindLabel("replace_part"), "เปลี่ยนอะไหล่");
  assert.equal(model.requestKindLabel("unknown"), "unknown", "an unknown value is shown as it is");
  assert.equal(model.requestKindLabel(null), "");
});

test("'other' choices are shown with the typed text, others without it", () => {
  assert.equal(model.requestKindText("other", " ล้างเครื่อง "), "อื่นๆ · ล้างเครื่อง");
  assert.equal(model.requestKindText("repair", "ignored"), "ซ่อม");
  assert.equal(model.requestKindText("other", ""), "อื่นๆ");
  assert.equal(model.repairTargetText("other", "จอภาพ"), "อื่นๆ · จอภาพ");
  assert.equal(model.repairTargetText("device", "x"), "อุปกรณ์");
  assert.equal(model.causeKindText("other", "ไฟตก"), "อื่นๆ · ไฟตก");
  assert.equal(model.causeKindText("usage", "x"), "การใช้งาน");
  assert.equal(model.repairMethodText("sent_out", "ร้านคอมพิวเตอร์ ก."), "ส่งซ่อมที่ ร้านคอมพิวเตอร์ ก.");
  assert.equal(model.repairMethodText("external_onsite", "นายช่างบี"), "เรียกผู้ซ่อมจากภายนอก นายช่างบี");
  assert.equal(model.repairMethodText("external_onsite", ""), "เรียกผู้ซ่อมจากภายนอก");
  assert.equal(model.repairMethodText("internal", "ตกค้าง"), "ซ่อม-แก้ไขภายใน", "an internal repair never shows an outside repairer");
  assert.equal(model.deviceText({ asset_code: " PC-001 ", device_name: "Dell" }), "PC-001 · Dell");
  assert.equal(model.deviceText({ asset_code: null, device_name: "Dell" }), "Dell");
});

test("status labels, badge classes and the requester's own wording", () => {
  assert.equal(model.statusLabel("pending_it_mgr"), "รอผู้อนุมัติขั้น IT");
  assert.equal(model.statusLabel("received"), "จบงานแล้ว");
  assert.equal(model.statusLabel("need_info"), "รอผู้แจ้งตอบ");
  assert.equal(model.statusBadgeClass("it_closed"), "pending_verify");
  assert.equal(model.statusBadgeClass("need_info"), "more_info");
  assert.equal(model.statusBadgeClass("zzz"), "");
  assert.equal(model.myStatusLabel("it_closed"), "IT ส่งงานแล้ว รอคุณยืนยัน");
  assert.equal(model.myStatusLabel("need_info"), "รอคุณตอบ");
  assert.equal(model.myStatusLabel("approved"), "อนุมัติครบ");
  assert.equal(model.isTestDoc("TEST-IT01-26/001"), true);
  assert.equal(model.isTestDoc("IT01-26/001"), false);
});

test("the module version starts at 1.00 and no text of this module says 'ใบสั่งงาน'", () => {
  assert.equal(model.MODULE_VERSION, "1.00");
  assert.match(model.VERSION_DATE, /^\d{4}-\d{2}-\d{2}$/);
  for (const file of ["modules/itrp-model.js", "modules/itrp-pages.js", "modules/module-itrp.js"]) {
    // คอมเมนต์อ้างถึงใบสั่งงาน IT (โมดูลต้นแบบ) ได้ แต่ข้อความที่ผู้ใช้เห็นต้องเป็น "ใบแจ้งซ่อม"
    const code = read(file).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n").replace(/\/\/[^\n]*$/gm, "");
    assert.doesNotMatch(code, /ใบสั่งงาน/, `${file} must say ใบแจ้งซ่อม everywhere`);
  }
});

/* ---------- วันที่ / เวลา ---------- */
test("dates are dd/mm/yyyy in the Buddhist year, times are Bangkok", () => {
  assert.equal(model.formatDate("2026-11-21"), "21/11/2569");
  assert.equal(model.formatDate(null), "—");
  assert.equal(model.formatDateTime("2026-11-21T03:05:00Z"), "21/11/2569 10:05");
  assert.equal(model.formatDateTime("2026-12-31T17:30:00Z"), "01/01/2570 00:30", "crosses midnight in Bangkok");
  assert.equal(model.formatDateOf("2026-11-21T03:05:00Z"), "21/11/2569");
  assert.equal(model.formatTimeOf("2026-11-21T03:05:00Z"), "10:05");
  assert.equal(model.formatDateOf(null), "");
  assert.equal(model.formatTimeOf(undefined), "");
  assert.equal(model.todayBangkok(new Date("2026-12-31T17:30:00Z")), "2027-01-01");
  assert.equal(model.isRealDate("2026-02-30"), false);
  assert.equal(model.isRealDate("2026-02-28"), true);
});

test("total repair time is whole hours from the start event to the latest completion", () => {
  const at = (iso) => iso;
  assert.deepEqual(plain(model.repairDuration(at("2026-11-21T01:00:00Z"), at("2026-11-21T03:59:59Z"))), { days: 0, hours: 2, totalHours: 2, text: "2 ชม." });
  assert.deepEqual(plain(model.repairDuration(at("2026-11-21T01:00:00Z"), at("2026-11-23T04:00:00Z"))), { days: 2, hours: 3, totalHours: 51, text: "2 วัน 3 ชม." });
  assert.equal(model.repairDuration("2026-11-21T01:00:00Z", "2026-11-22T01:00:00Z").text, "1 วัน");
  assert.equal(model.repairDuration("2026-11-21T01:00:00Z", "2026-11-21T01:59:00Z").text, "น้อยกว่า 1 ชม.");
  assert.equal(model.repairDuration("2026-11-21T01:00:00Z", "2026-11-21T01:00:00Z").text, "น้อยกว่า 1 ชม.");
  assert.equal(model.repairDuration("2026-11-22T01:00:00Z", "2026-11-21T01:00:00Z"), null, "time never runs backwards");
  assert.equal(model.repairDuration(null, "2026-11-21T01:00:00Z"), null);
  assert.equal(model.repairDuration("2026-11-21T01:00:00Z", undefined), null);
  assert.equal(model.repairDuration("garbage", "2026-11-21T01:00:00Z"), null);
});

/* ---------- ฟอร์มแจ้งซ่อม ---------- */
const GOOD_FORM = { asset_code: "PC-001", device_name: "Dell OptiPlex", request_kind: "repair", request_kind_note: "", repair_target: "computer", repair_target_note: "", symptom: "เปิดไม่ติด", is_urgent: false };
const repairErrors = (values) => validate(model.repairRules({ requestKind: () => values.request_kind, repairTarget: () => values.repair_target }), values).map((error) => [error.name, error.message]);

test("the repair form: only the device name, request kind, repair target and symptom are required", () => {
  assert.deepEqual(repairErrors(GOOD_FORM), []);
  assert.deepEqual(repairErrors({ ...GOOD_FORM, asset_code: "" }), [], "the asset code is optional");
  assert.deepEqual(repairErrors(model.EMPTY_REPAIR_FORM), [
    ["device_name", "กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์"],
    ["request_kind", "กรุณาเลือกประเภทคำขอ"],
    ["repair_target", "กรุณาเลือกประเภทงานซ่อม"],
    ["symptom", "กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น"],
  ]);
  for (const missing of ["device_name", "symptom"]) assert.equal(repairErrors({ ...GOOD_FORM, [missing]: "   " })[0][0], missing, "spaces only is empty");
});

test("choosing 'other' for the request kind or repair target requires the typed text", () => {
  assert.deepEqual(repairErrors({ ...GOOD_FORM, request_kind: "other", request_kind_note: " " }), [["request_kind_note", "กรุณาระบุประเภทคำขอ (เมื่อเลือก \"อื่นๆ\")"]]);
  assert.deepEqual(repairErrors({ ...GOOD_FORM, request_kind: "other", request_kind_note: "ล้างเครื่อง" }), []);
  assert.deepEqual(repairErrors({ ...GOOD_FORM, repair_target: "other", repair_target_note: "" }), [["repair_target_note", "กรุณาระบุประเภทงานซ่อม (เมื่อเลือก \"อื่นๆ\")"]]);
  assert.deepEqual(repairErrors({ ...GOOD_FORM, request_kind: "repair", request_kind_note: "ตกค้างจากตัวเลือกเดิม" }), [], "text kept from an earlier choice is not an error");
});

test("the repair form lengths match the database", () => {
  const long = (n) => "ก".repeat(n);
  assert.deepEqual(repairErrors({ ...GOOD_FORM, asset_code: long(50) }), []);
  assert.equal(repairErrors({ ...GOOD_FORM, asset_code: long(51) })[0][0], "asset_code");
  assert.deepEqual(repairErrors({ ...GOOD_FORM, device_name: long(200) }), []);
  assert.equal(repairErrors({ ...GOOD_FORM, device_name: long(201) })[0][0], "device_name");
  assert.deepEqual(repairErrors({ ...GOOD_FORM, symptom: long(2000) }), []);
  assert.equal(repairErrors({ ...GOOD_FORM, symptom: long(2001) })[0][1], "อาการเสียต้องไม่เกิน 2,000 ตัวอักษร");
  assert.equal(repairErrors({ ...GOOD_FORM, request_kind: "other", request_kind_note: long(201) })[0][0], "request_kind_note");
  assert.equal(repairErrors({ ...GOOD_FORM, repair_target: "other", repair_target_note: long(201) })[0][0], "repair_target_note");
  assert.equal(model.MAX_FILES, 10);
  assert.equal(model.MAX_FILE_BYTES, 20 * 1024 * 1024);
});

test("every repair field is on step 1 or step 2 in screen order", () => {
  const rules = model.repairRules();
  assert.deepEqual(rules.map((rule) => [rule.name, rule.step]), [["asset_code", 1], ["device_name", 1], ["request_kind", 1], ["request_kind_note", 1], ["repair_target", 1], ["repair_target_note", 1], ["symptom", 2]]);
  const form = model.repairRules({ requestKind: () => "other" });
  assert.equal(form.find((rule) => rule.name === "request_kind_note").required, true, "required reads the current choice each time");
  assert.equal(model.repairRules().find((rule) => rule.name === "request_kind_note").required, false);
});

test("createParams trims, sends null for blank/unused text, and never sends a document number", () => {
  assert.deepEqual(plain(model.createParams({ ...GOOD_FORM, asset_code: " PC-001 ", device_name: "  Dell  ", symptom: " เปิดไม่ติด ", request_kind_note: "ignored", repair_target_note: "ignored", is_urgent: true })), {
    p_asset_code: "PC-001", p_device_name: "Dell", p_request_kind: "repair", p_request_kind_note: null, p_repair_target: "computer", p_repair_target_note: null, p_symptom: "เปิดไม่ติด", p_is_urgent: true,
  });
  const other = model.createParams({ ...GOOD_FORM, asset_code: "  ", request_kind: "other", request_kind_note: " ล้างเครื่อง ", repair_target: "other", repair_target_note: " จอ " });
  assert.equal(other.p_asset_code, null);
  assert.equal(other.p_request_kind_note, "ล้างเครื่อง");
  assert.equal(other.p_repair_target_note, "จอ");
  assert.deepEqual(Object.keys(model.createParams(GOOD_FORM)).sort(), ["p_asset_code", "p_device_name", "p_is_urgent", "p_repair_target", "p_repair_target_note", "p_request_kind", "p_request_kind_note", "p_symptom"]);
  assert.equal(model.createParams({ ...GOOD_FORM, is_urgent: undefined }).p_is_urgent, false);
});

/* ---------- ฟอร์มส่งงาน (ส่วนสำหรับแผนก IT) ---------- */
const GOOD_COMPLETE = { cause: "แรมเสื่อม", cause_kind: "usage", cause_kind_note: "", repair_method: "internal", repair_vendor: "", repair_action: "เปลี่ยนแรม", pr_po_no: "" };
const completeErrors = (values) => validate(model.completeRules({ causeKind: () => values.cause_kind, repairMethod: () => values.repair_method }), values).map((error) => [error.name, error.message]);

test("the IT section requires cause, cause summary, repair method and repair action", () => {
  assert.deepEqual(completeErrors(GOOD_COMPLETE), []);
  assert.deepEqual(completeErrors(model.EMPTY_COMPLETE_FORM), [
    ["cause", "กรุณาระบุสาเหตุ"],
    ["cause_kind", "กรุณาเลือกสรุปสาเหตุเกิดจาก"],
    ["repair_method", "กรุณาเลือกการตรวจซ่อม"],
    ["repair_action", "กรุณาระบุการซ่อม-แก้ไขที่เกิดขึ้น"],
  ]);
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, pr_po_no: "" }), [], "PR./PO. is optional");
});

test("'other' cause needs text and 'sent out' needs the place, while an outside repairer's name is optional", () => {
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, cause_kind: "other" }), [["cause_kind_note", "กรุณาระบุสรุปสาเหตุ (เมื่อเลือก \"อื่นๆ\")"]]);
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, cause_kind: "other", cause_kind_note: "ไฟตก" }), []);
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, repair_method: "sent_out" }), [["repair_vendor", "กรุณาระบุสถานที่ที่ส่งซ่อม"]]);
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, repair_method: "sent_out", repair_vendor: "ร้าน ก." }), []);
  assert.deepEqual(completeErrors({ ...GOOD_COMPLETE, repair_method: "external_onsite" }), [], "the repairer's name is optional");
  const long = (n) => "ก".repeat(n);
  assert.equal(completeErrors({ ...GOOD_COMPLETE, cause: long(2001) })[0][0], "cause");
  assert.equal(completeErrors({ ...GOOD_COMPLETE, repair_action: long(2001) })[0][0], "repair_action");
  assert.equal(completeErrors({ ...GOOD_COMPLETE, pr_po_no: long(101) })[0][0], "pr_po_no");
  assert.equal(completeErrors({ ...GOOD_COMPLETE, repair_method: "sent_out", repair_vendor: long(201) })[0][0], "repair_vendor");
  assert.equal(completeErrors({ ...GOOD_COMPLETE, cause_kind: "other", cause_kind_note: long(201) })[0][0], "cause_kind_note");
});

test("parts: blank rows are skipped, a filled row needs an item and a quantity above zero, price is optional", () => {
  const blank = { ...model.EMPTY_PART_ROW };
  assert.deepEqual(plain(model.normalizeParts([blank, blank])), { rows: [{ item_name: "", quantity: "", price: null, note: "" }, { item_name: "", quantity: "", price: null, note: "" }], errors: [], filled: 0 });
  assert.deepEqual(plain(model.normalizeParts([{ item_name: " RAM 8GB ", quantity: "2", price: "1,250.50", note: " ใหม่ " }])), {
    rows: [{ item_name: "RAM 8GB", quantity: "2", price: "1250.50", note: "ใหม่" }], errors: [], filled: 1,
  });
  assert.equal(model.normalizeParts([{ item_name: "สาย", quantity: "1", price: "", note: "" }]).rows[0].price, null, "an empty price is null");
  assert.deepEqual(model.normalizeParts([blank, { item_name: "", quantity: "1", price: "", note: "" }]).errors, ["แถวที่ 2: กรุณาระบุรายการอะไหล่/วัสดุ"], "the row number is the row on screen");
  assert.deepEqual(model.normalizeParts([{ item_name: "สาย", quantity: "", price: "", note: "" }]).errors, ["แถวที่ 1: กรุณาระบุจำนวน"]);
  assert.deepEqual(model.normalizeParts([{ item_name: "", quantity: "", price: "", note: "หมายเหตุอย่างเดียว" }]).errors, ["แถวที่ 1: กรุณาระบุรายการอะไหล่/วัสดุ", "แถวที่ 1: กรุณาระบุจำนวน"]);
});

test("parts numbers follow the database pattern: up to 8 digits and 2 decimals, quantity above zero, price not negative", () => {
  const row = (quantity, price = "") => [{ item_name: "x", quantity, price, note: "" }];
  const qtyMessage = "แถวที่ 1: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)";
  const priceMessage = "แถวที่ 1: ราคาต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)";
  for (const ok of ["1", "0.5", "0.01", "12345678", "1.25", "1,000"]) assert.deepEqual(model.normalizeParts(row(ok)).errors, [], `quantity ${ok}`);
  for (const bad of ["0", "0.00", "-1", "abc", "1.234", "123456789", ".5", "1e3", "1 2"]) assert.deepEqual(model.normalizeParts(row(bad)).errors, [qtyMessage], `quantity ${bad}`);
  for (const ok of ["0", "0.00", "99999999.99", "1,250.5"]) assert.deepEqual(model.normalizeParts(row("1", ok)).errors, [], `price ${ok}`);
  for (const bad of ["-5", "abc", "1.234", "123456789", "NaN"]) assert.deepEqual(model.normalizeParts(row("1", bad)).errors, [priceMessage], `price ${bad}`);
  assert.equal(model.normalizeParts(row("1", "0")).rows[0].price, "0", "a free part keeps price 0, not null");
  assert.deepEqual(model.normalizeParts([{ item_name: "ก".repeat(201), quantity: "1", price: "", note: "" }]).errors, ["แถวที่ 1: ชื่อรายการต้องไม่เกิน 200 ตัวอักษร"]);
  assert.deepEqual(model.normalizeParts([{ item_name: "x", quantity: "1", price: "", note: "ก".repeat(201) }]).errors, ["แถวที่ 1: หมายเหตุต้องไม่เกิน 200 ตัวอักษร"]);
});

test("at most 10 parts rows", () => {
  const rows = (n) => Array.from({ length: n }, () => ({ item_name: "x", quantity: "1", price: "", note: "" }));
  assert.deepEqual(model.normalizeParts(rows(10)).errors, []);
  assert.deepEqual(model.normalizeParts(rows(11)).errors, ["รายการอะไหล่/วัสดุที่ใช้ต้องไม่เกิน 10 แถว"]);
  assert.equal(model.MAX_PARTS, 10);
  assert.deepEqual(plain(model.normalizeParts(undefined)), { rows: [], errors: [], filled: 0 });
});

test("completeParams matches app_itrp_complete and clears text that does not belong to the choice", () => {
  const parts = model.normalizeParts([{ item_name: "RAM", quantity: "1", price: "100", note: "" }]).rows;
  assert.deepEqual(plain(model.completeParams("rid", { ...GOOD_COMPLETE, cause: " แรมเสื่อม ", repair_action: " เปลี่ยนแรม ", pr_po_no: " PO-1 ", cause_kind_note: "ignored", repair_vendor: "ignored" }, parts)), {
    p_request_id: "rid", p_cause: "แรมเสื่อม", p_cause_kind: "usage", p_cause_kind_note: null, p_repair_method: "internal", p_repair_vendor: null,
    p_repair_action: "เปลี่ยนแรม", p_pr_po_no: "PO-1", p_parts: [{ item_name: "RAM", quantity: "1", price: "100", note: "" }],
  });
  const other = model.completeParams("rid", { ...GOOD_COMPLETE, cause_kind: "other", cause_kind_note: " ไฟตก ", repair_method: "sent_out", repair_vendor: " ร้าน ก. " }, []);
  assert.equal(other.p_cause_kind_note, "ไฟตก");
  assert.equal(other.p_repair_vendor, "ร้าน ก.");
  assert.deepEqual(other.p_parts, []);
  assert.equal(model.completeParams("rid", { ...GOOD_COMPLETE, repair_method: "external_onsite" }, undefined).p_repair_vendor, null, "an optional repairer name left blank is null");
  assert.deepEqual(model.completeParams("rid", GOOD_COMPLETE).p_parts, []);
});

/* ---------- บันทึกการซ่อมชุดล่าสุดและประวัติ ---------- */
const REPORT_A = { id: "ra", completed_at: "2026-11-21T03:00:00Z", completed_by_full_name: "ช่าง ก", cause: "เก่า", cause_kind: "usage", cause_kind_note: null, repair_method: "internal", repair_vendor: null, repair_action: "ซ่อมรอบแรก", pr_po_no: null, parts: [] };
const REPORT_B = { id: "rb", completed_at: "2026-11-22T03:00:00Z", completed_by_full_name: "ช่าง ข", cause: "ใหม่", cause_kind: "other", cause_kind_note: "ไฟตก", repair_method: "sent_out", repair_vendor: "ร้าน ก.", repair_action: "ส่งซ่อม", pr_po_no: "PO-9",
  parts: [{ line_no: 2, item_name: "สาย", quantity: 1, price: null, note: null }, { line_no: 1, item_name: "RAM", quantity: 2.5, price: 1250, note: "ใหม่" }] };

test("the latest repair report is for display/print and earlier sets are history", () => {
  assert.deepEqual(plain(model.repairReports({})), { latest: null, earlier: [] });
  assert.deepEqual(plain(model.repairReports({ repair_report: REPORT_A, repair_reports: [REPORT_A] })), { latest: REPORT_A, earlier: [] });
  const both = model.repairReports({ repair_report: REPORT_B, repair_reports: [REPORT_A, REPORT_B] });
  assert.equal(both.latest.id, "rb");
  assert.deepEqual(both.earlier.map((report) => report.id), ["ra"]);
  assert.equal(model.repairReports({ repair_reports: [REPORT_A, REPORT_B] }).latest.id, "rb", "falls back to the last of the list");
  assert.equal(model.reportView(null), null);
});

test("a report is shown with Thai labels and its parts in line order", () => {
  const view = model.reportView(REPORT_B);
  assert.equal(view.causeKind, "อื่นๆ · ไฟตก");
  assert.equal(view.repairMethod, "ส่งซ่อมที่ ร้าน ก.");
  assert.equal(view.prPoNo, "PO-9");
  assert.deepEqual(plain(view.parts), [
    { no: 1, item: "RAM", quantity: "2.5", price: "1,250.00", note: "ใหม่" },
    { no: 2, item: "สาย", quantity: "1", price: "", note: "" },
  ]);
  assert.equal(model.reportView(REPORT_A).causeKind, "การใช้งาน");
  assert.equal(model.formatQuantity(3), "3");
  assert.equal(model.formatQuantity("0.50"), "0.5");
  assert.equal(model.formatPrice("0"), "0.00");
  assert.equal(model.formatPrice(null), "");
  assert.equal(model.formatPrice(1234567.5), "1,234,567.50");
});

/* ---------- ลายเซ็นและช่องสรุปบนใบพิมพ์ ---------- */
test("print signatures map approver / delivery / receipt / management acknowledgement from the detail", () => {
  const detail = {
    requester: { full_name: "สมหญิง ผู้แจ้ง" },
    approvals: { dept: { by: "สมชาย ผจก.", at: "2026-11-21T01:00:00Z" }, it_mgr: { by: "รสริน เชน", at: "2026-11-21T02:00:00Z" } },
    completed: { by: "ช่าง ไอที", at: "2026-11-22T03:00:00Z" },
    received: { by: "สมหญิง ผู้แจ้ง", at: "2026-11-23T04:00:00Z" },
  };
  assert.deepEqual(plain(model.printSignoffs(detail)), {
    approver: { name: "สมชาย ผจก.", at: "2026-11-21T01:00:00Z", remark: null },
    delivered: { name: "ช่าง ไอที", at: "2026-11-22T03:00:00Z" },
    received: { name: "สมหญิง ผู้แจ้ง", at: "2026-11-23T04:00:00Z" },
    acknowledged: { name: "รสริน เชน", at: "2026-11-21T02:00:00Z", remark: null },
  });
  const empty = model.printSignoffs({ approvals: { dept: null, it_mgr: null }, completed: null, received: null });
  for (const key of ["approver", "delivered", "received", "acknowledged"]) assert.equal(empty[key].name, null, `${key} stays blank until it happens`);
  assert.deepEqual(plain(model.printSignoffs({})), plain(empty));
});

test("one person approving both steps and a manager self-approving are marked on the sheet", () => {
  const same = model.printSignoffs({ requester: { full_name: "อ" }, approvals: { dept: { by: "รสริน เชน", at: "t1" }, it_mgr: { by: "รสริน เชน", at: "t1" } } });
  assert.equal(same.approver.remark, "อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น");
  assert.equal(same.acknowledged.remark, "อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น");
  const self = model.printSignoffs({ requester: { full_name: "สมชาย ผจก." }, approvals: { dept: { by: "สมชาย ผจก.", at: "t1" }, it_mgr: { by: "รสริน เชน", at: "t2" } } });
  assert.equal(self.approver.remark, "อนุมัติในตัวเมื่อแจ้งซ่อม");
  assert.equal(self.acknowledged.remark, null);
});

test("outcome boxes: 'complete' ticks when the requester confirmed receipt, 'rework' while a rework request is open", () => {
  assert.deepEqual(plain(model.printOutcome({ status: "received", rework_open: false })), { complete: true, rework: false });
  assert.deepEqual(plain(model.printOutcome({ status: "in_progress", rework_open: true })), { complete: false, rework: true });
  assert.deepEqual(plain(model.printOutcome({ status: "it_closed", rework_open: false })), { complete: false, rework: false });
  assert.deepEqual(plain(model.printOutcome(null)), { complete: false, rework: false });
});

/* ---------- ปุ่มตาม allowed_actions ---------- */
test("buttons come only from allowed_actions in a fixed order, and unknown actions are dropped", () => {
  const labels = (allowed) => model.actionButtons(allowed).map((button) => button.label);
  assert.deepEqual(labels([]), []);
  assert.deepEqual(labels(undefined), []);
  assert.deepEqual(labels(["cancel", "approve", "reject", "request_info"]), ["อนุมัติ", "ไม่อนุมัติ", "ถามผู้แจ้ง", "ยกเลิกใบแจ้งซ่อม"]);
  assert.deepEqual(labels(["complete", "start", "request_info"]), ["ถามผู้แจ้ง", "เริ่มดำเนินการ", "ส่งงาน"]);
  assert.deepEqual(labels(["receive", "request_rework", "cancel"]), ["ได้รับงานเรียบร้อยแล้ว", "แก้ไขงาน", "ยกเลิกใบแจ้งซ่อม"]);
  assert.deepEqual(labels(["edit_access", "approve"]), ["อนุมัติ"], "there is no access section in repair requests");
});

test("'send work' opens the IT form instead of calling the RPC straight away; reasons are required for reject and cancel only", () => {
  assert.equal(model.ACTION_BUTTONS.complete.opens, "complete");
  assert.equal(model.ACTION_BUTTONS.complete.rpc, "app_itrp_complete");
  assert.equal(model.ACTION_BUTTONS.request_rework.opens, "rework");
  assert.equal(model.ACTION_BUTTONS.request_info.opens, "ask");
  assert.equal(model.ACTION_BUTTONS.provide_info.inline, true);
  for (const [action, spec] of Object.entries(model.ACTION_BUTTONS)) {
    assert.equal(Boolean(spec.reason), ["reject", "cancel"].includes(action), action);
    if (spec.rpc) assert.match(spec.rpc, /^app_itrp_/, action);
  }
  const buttons = model.actionButtons(["provide_info", "complete"]);
  assert.deepEqual(buttons.map((button) => button.action), ["complete", "provide_info"]);
});

test("cancelling a request that waits for an answer, by someone other than the requester, is shown as cancelling on behalf", () => {
  const detail = { requester: { employee_no: "AA1" } };
  assert.equal(model.isCancelOnBehalf(detail, { employee_no: "IT3462" }), true);
  assert.equal(model.isCancelOnBehalf(detail, { employee_no: "AA1" }), false);
  assert.equal(model.isCancelOnBehalf(detail, {}), false);
  assert.equal(model.cancelReasonSpec(detail, { employee_no: "IT3462" }).maxLength, 470);
  assert.equal(model.cancelReasonSpec(detail, { employee_no: "AA1" }).maxLength, 500);
  assert.match(model.cancelReasonSpec(detail, { employee_no: "IT3462" }).title, /แทนผู้แจ้ง/);
  assert.equal(model.eventLabelFor({ action: "cancelled", actor_employee_no: "IT3462" }, { employee_no: "AA1" }), "IT ยกเลิกแทนผู้แจ้ง");
  assert.equal(model.eventLabelFor({ action: "cancelled", actor_employee_no: "AA1" }, { employee_no: "AA1" }), "ผู้แจ้งยกเลิก");
  assert.equal(model.eventLabel("created"), "แจ้งซ่อม");
});

test("approving as the IT-step approver before the department step counts as both steps", () => {
  const role = { is_it_approver: true };
  assert.equal(model.countsAsBothSteps({ approvals: { dept: null, it_mgr: null } }, role), true);
  assert.equal(model.countsAsBothSteps({ approvals: { dept: { by: "x" }, it_mgr: null } }, role), false);
  assert.equal(model.countsAsBothSteps({ approvals: { dept: null, it_mgr: null } }, { is_it_approver: false }), false);
  assert.match(model.confirmMessageFor("approve", { approvals: { dept: null, it_mgr: null } }, role), /^ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT · /);
  assert.doesNotMatch(model.confirmMessageFor("approve", { approvals: { dept: { by: "x" }, it_mgr: null } }, role), /ทั้งขั้นแผนก/);
  assert.equal(model.confirmMessageFor("nope", {}, {}), "");
});

test("the approval summary and the post-send toast", () => {
  const detail = { status: "pending_it_mgr", approvals: { dept: { by: "ผจก", at: "t" }, it_mgr: null }, events: [] };
  assert.deepEqual(plain(model.approvalSummary(detail)).map((step) => step.state), ["approved", "waiting"]);
  assert.deepEqual(plain(model.approvalSummary({ status: "rejected", approvals: { dept: null, it_mgr: null }, events: [{ action: "dept_rejected", actor_full_name: "ผจก", created_at: "t" }] })).map((step) => step.state), ["rejected", "none"]);
  assert.equal(model.completeToast({ requester: { full_name: "สมหญิง" } }, false), "ส่งกลับให้ สมหญิง ตรวจและยืนยันแล้ว");
  assert.match(model.completeToast({ requester: { full_name: "สมหญิง" } }, true), /สลับเป็นบัญชีผู้แจ้ง/);
  assert.equal(model.answerToast("it"), "ส่งคำตอบแล้ว ใบกลับไปที่ทีม IT");
});

/* ---------- งานของ IT และตัวเลขบนการ์ด ---------- */
const row = (id, status, extra = {}) => ({ id, doc_no: `IT01-26/${String(id).padStart(3, "0")}`, status, is_urgent: false, created_at: `2026-11-${10 + Number(id)}T00:00:00Z`, ...extra });

test("IT work is grouped by status, urgent first, then rework due date, then the time reported", () => {
  const groups = model.groupItOrders([
    row(1, "approved"), row(2, "approved", { is_urgent: true }), row(3, "pending_it_mgr", { is_urgent: true }), row(4, "pending_dept"), row(5, "in_progress", { rework_round: 1, rework_due_date: "2026-12-01" }),
    row(6, "in_progress", { rework_round: 1, rework_due_date: "2026-11-30" }), row(7, "in_progress"), row(8, "it_closed"), row(9, "need_info"), row(10, "received"), row(11, "cancelled"),
  ]);
  assert.deepEqual(groups.to_start.map((item) => item.id), [2, 3, 1], "an urgent request waiting for approval can already start");
  assert.deepEqual(groups.awaiting_approval.map((item) => item.id), [4]);
  assert.deepEqual(groups.in_progress.map((item) => item.id), [6, 5, 7], "earlier rework due date first, no rework last");
  assert.deepEqual(groups.awaiting_receive.map((item) => item.id), [8]);
  assert.deepEqual(groups.awaiting_info.map((item) => item.id), [9]);
  assert.deepEqual(groups.closed.map((item) => item.id), [11, 10], "closed ones: newest first");
  assert.deepEqual(model.IT_GROUPS.map((group) => group.key), ["to_start", "in_progress", "awaiting_info", "awaiting_receive", "awaiting_approval", "closed"]);
});

test("counts: IT actionable, waiting for me, and open requests without double counting", () => {
  const rows = [row(1, "approved"), row(2, "in_progress"), row(3, "it_closed"), row(4, "need_info"), row(5, "pending_dept"), row(6, "received")];
  assert.equal(model.itActionableCount(rows), 2);
  assert.equal(model.itActionableCount(null), 0);
  assert.deepEqual(model.mineWaiting(rows), { confirm: 1, answer: 1, total: 2 });
  assert.equal(model.waitingForMeCount(rows), 5);
  assert.equal(model.mineWaitingNote({ confirm: 1, answer: 1 }), " (รอคุณยืนยัน 1 · รอคุณตอบ 1)");
  assert.equal(model.mineWaitingNote({ confirm: 2, answer: 0 }), " ที่รอคุณยืนยัน");
  assert.equal(model.mineWaitingNote({ confirm: 0, answer: 2 }), " ที่รอคุณตอบ");
  assert.equal(model.openOrderCount(rows, [row(1, "approved"), row(7, "pending_dept")], null, undefined), 6, "request 1 is counted once");
  assert.equal(model.openOrderCount([row(1, "received"), row(2, "rejected"), row(3, "cancelled")]), 0);
  assert.equal(model.openOrderCount([{ status: "approved" }]), 0, "a row without an id is skipped");
  assert.deepEqual(model.itApprovalProgress({ has_dept_approved: true, has_it_mgr_approved: false }).map((step) => step.done), [true, false]);
});

test("the card summary shows 'N รอคุณ' only for work waiting on me, and keeps the open count apart", () => {
  const summary = model.cardSummary({ approvals: 2, itWork: 1, toConfirm: 0, toAnswer: 3, openCount: 7 });
  assert.equal(summary.total, 6);
  assert.equal(summary.badge, "6 รอคุณ");
  assert.equal(summary.openCount, 7);
  assert.equal(summary.title, "รออนุมัติ 2 · งาน IT ค้าง 1 · รอคุณตอบ 3");
  const none = model.cardSummary({ approvals: null, itWork: null, openCount: null });
  assert.deepEqual(plain(none), { total: 0, parts: [], openCount: null, badge: "", title: "" });
  assert.equal(model.cardSummary().openCount, null);
  assert.equal(model.cardSummary({ openCount: 0 }).openCount, 0);
});

/* ---------- รอบแก้ไข / ถาม-ตอบ ---------- */
test("rework: details and a due date that is not in the past are required", () => {
  const rules = model.reworkRules({ today: () => "2026-11-21" });
  const errors = (values) => validate(rules, values).map((error) => error.name);
  assert.deepEqual(errors({ details: "", due_date: "" }), ["details", "due_date"]);
  assert.deepEqual(errors({ details: "ยังไม่หาย", due_date: "2026-11-20" }), ["due_date"]);
  assert.deepEqual(errors({ details: "ยังไม่หาย", due_date: "2026-11-21" }), []);
  assert.deepEqual(errors({ details: "ยังไม่หาย", due_date: "2026-02-30" }), ["due_date"]);
  assert.deepEqual(plain(model.reworkParams("rid", { details: " ยังไม่หาย ", due_date: " 2026-11-25 " })), { p_request_id: "rid", p_details: "ยังไม่หาย", p_due_date: "2026-11-25" });
  assert.equal(model.reworkTag(2, "2026-11-25"), "แก้ไขครั้งที่ 2 · กำหนด 25/11/2569");
  assert.equal(model.reworkTag(0, "2026-11-25"), "");
});

test("question/answer rows, the pending question and the info form rules", () => {
  const detail = {
    info_return_status: "in_progress",
    info_pending: { comment_id: 2, stage: "it", body: "รุ่นอะไร", asked_at: "t", asked_by_full_name: "ช่าง" },
    comments: [
      { id: 2, kind: "question", stage: "it", body: "รุ่นอะไร", created_at: "t", author_full_name: "ช่าง", attachments: [{ id: "f2" }] },
      { id: 1, kind: "answer", stage: "dept", body: "ตอบเก่า", created_at: "t0", author_full_name: "ผู้แจ้ง" },
    ],
  };
  assert.deepEqual(model.commentRows(detail).map((comment) => [comment.no, comment.id, comment.kindLabel, comment.stageLabel]), [[1, 1, "ตอบ", "ผู้จัดการแผนก"], [2, 2, "ถาม", "ทีม IT"]]);
  assert.equal(model.pendingQuestion(detail).returnLabel, "กำลังดำเนินการ");
  assert.equal(model.pendingQuestion({}), null);
  assert.equal(model.allFiles(detail).length, 1);
  assert.equal(model.infoBadgeTitle({ status: "need_info", info_stage: "it", info_return_status: "in_progress" }, true), "ทีม IT ถามคุณ · ตอบแล้วใบกลับไปที่ กำลังดำเนินการ");
  assert.equal(model.infoBadgeTitle({ status: "approved" }), "");
  assert.deepEqual(validate(model.infoRules("ask"), { body: "" }).map((error) => error.message), ["กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง"]);
  assert.deepEqual(validate(model.infoRules("answer"), { body: "" }).map((error) => error.message), ["กรุณาพิมพ์คำตอบ"]);
  assert.deepEqual(plain(model.infoParams("rid", { body: " สวัสดี " })), { p_request_id: "rid", p_body: "สวัสดี" });
  assert.equal(model.validateReason("  "), "กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  assert.equal(model.validateReason("", "ยกเลิก"), "กรุณาระบุเหตุผลที่ยกเลิก");
  assert.equal(model.validateReason("ก".repeat(501)), "เหตุผลต้องไม่เกิน 500 ตัวอักษร");
  assert.equal(model.validateReason("ก".repeat(500)), null);
});

/* ---------- ไฟล์ ---------- */
test("files: type follows the extension, limits are 10 files and 20 MB each", () => {
  const file = (name, size = 10) => ({ name, size });
  assert.equal(model.fileMime(file("a.CSV")), "text/csv");
  assert.equal(model.fileMime(file("a.ppt")), null, ".ppt is not accepted");
  assert.equal(model.fileMime(file("a.heic")), "image/heic");
  assert.equal(model.validateFiles([file("a.jpg")]), null);
  assert.equal(model.validateFiles(Array.from({ length: 11 }, (_, i) => file(`${i}.jpg`))), "แนบได้ไม่เกิน 10 ไฟล์ต่อครั้ง");
  assert.match(model.validateFiles([file("a.exe")]), /^a\.exe: ชนิดไฟล์นี้ไม่รองรับ/);
  assert.equal(model.validateFiles([file("a.jpg", 0)]), "a.jpg: ไฟล์ว่างเปล่า");
  assert.equal(model.validateFiles([file("a.pdf", 20 * 1024 * 1024 + 1)]), "a.pdf: ไฟล์ต้องมีขนาดไม่เกิน 20 MB");
  assert.equal(model.fileBucket(false), "itrp-files");
  assert.equal(model.fileBucket(true), "itrp-test-files");
  assert.equal(model.filePath("2F6C1B52-9D1E-4C7A-8A43-0C5E8F3A9B10", "ABC", file("Photo.JPG")), "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10/abc.jpg");
  assert.equal(model.formatFileSize(0), "—");
  assert.equal(model.formatFileSize(2048), "2.0 KB");
  assert.equal(model.formatFileSize(5 * 1024 * 1024), "5.0 MB");
});

test("uploads: each file keeps its path, a failure does not stop the others, and a retry skips finished files", async () => {
  const calls = [];
  const entries = model.makeUploadEntries("rid", [{ name: "a.jpg", size: 1 }, { name: "b.png", size: 1 }, { name: "c.pdf", size: 1 }], (() => { let n = 0; return () => `u${(n += 1)}`; })());
  assert.deepEqual(entries.map((entry) => entry.path), ["rid/u1.jpg", "rid/u2.png", "rid/u3.pdf"]);
  let failB = true;
  const handlers = {
    upload: async (entry) => { calls.push(`up ${entry.path}`); },
    register: async (entry) => { calls.push(`reg ${entry.path}`); if (entry.file.name === "b.png" && failB) throw Object.assign(new Error("x"), { code: "" }); },
  };
  const failed = await model.runUploads(entries, handlers);
  assert.deepEqual(failed.map((entry) => entry.file.name), ["b.png"]);
  failB = false;
  calls.length = 0;
  assert.deepEqual(await model.runUploads(entries, handlers), []);
  assert.deepEqual(calls, ["reg rid/u2.png"], "only the failed registration is retried; the file is not uploaded twice");
  assert.equal(model.isAlreadyUploaded({ statusCode: "409" }), true);
  assert.equal(model.isFileRejection({ message: "กรุณาอัปโหลดไฟล์ใหม่" }), true);
  assert.equal(model.isFileRejection({ message: "network" }), false);
});

test("a file the database rejects is re-uploaded under a new path on retry", async () => {
  const [entry] = model.makeUploadEntries("rid", [{ name: "a.csv", size: 1 }], (() => { let n = 0; return () => `u${(n += 1)}`; })());
  let reject = true;
  const handlers = { upload: async () => {}, register: async () => { if (reject) throw Object.assign(new Error("กรุณาอัปโหลดไฟล์ใหม่"), { code: "23514" }); } };
  await model.runUploads([entry], handlers);
  assert.equal(entry.uploaded, false);
  assert.equal(entry.path, "rid/u2.csv");
  reject = false;
  assert.deepEqual(await model.runUploads([entry], handlers), []);
});

test("rework rounds carry their own files and attachment groups are ordered by round", () => {
  const detail = {
    reworks: [{ id: "r2", round_no: 2, details: "b", due_date: "2026-12-02", created_at: "t2", requested_by_full_name: "ผู้แจ้ง" }, { id: "r1", round_no: 1, details: "a", due_date: "2026-12-01", created_at: "t1", requested_by_full_name: "ผู้แจ้ง" }],
    attachments: [{ id: "f1", rework_id: "r1", round_no: 1 }, { id: "f0", rework_id: null, round_no: 0 }, { id: "f2", rework_id: "r2", round_no: 2 }],
  };
  assert.deepEqual(model.reworkRounds(detail).map((round) => [round.roundNo, round.label, round.files.map((file) => file.id)]), [[1, "แก้ไขครั้งที่ 1", ["f1"]], [2, "แก้ไขครั้งที่ 2", ["f2"]]]);
  assert.deepEqual(model.attachmentGroups(detail).map((group) => [group.roundNo, group.label]), [[0, "ตอนแจ้ง"], [1, "แก้ไขครั้งที่ 1"], [2, "แก้ไขครั้งที่ 2"]]);
  assert.deepEqual(plain(model.galleryFile({ id: "f", file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 3, storage_path: "p" })), { id: "f", file_name: "a.pdf", content_type: "application/pdf", size_bytes: 3, storage_path: "p" });
});

/* ---------- ตั้งค่า (เลขถัดไป / รายชื่อทีม) ---------- */
test("document numbers use IT01 and the next number can only move forward", () => {
  assert.equal(model.formatDocNo(false, 2026, 50), "IT01-26/050");
  assert.equal(model.formatDocNo(true, 2026, 5), "TEST-IT01-26/005");
  assert.equal(model.formatDocNo(false, 2027, 1234), "IT01-27/1234");
  assert.equal(model.validateNextSeq("50", 10), null);
  assert.match(model.validateNextSeq("10", 10), /ถอยหลังหรือซ้ำไม่ได้/);
  assert.equal(model.validateNextSeq("abc", 10), "กรุณากรอกเลขถัดไปเป็นจำนวนเต็ม");
  assert.equal(model.validateNextSeq("10000", 10), "เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999");
  assert.equal(model.staffRoleText({ is_it_admin: true, is_it_approver: true }), "ผู้ดูแลงาน IT · ผู้อนุมัติขั้น IT");
  assert.equal(model.staffRoleText({ is_it_approver: true }), "ผู้อนุมัติขั้น IT");
  assert.equal(model.staffRoleText({}), "");
});

test("the purge summary tells the owner when files are left to delete", () => {
  assert.deepEqual(plain(model.purgeSummary({ deleted: 12, total: 0, removed: 0 })), { complete: true, message: "ล้างข้อมูลทดสอบแล้ว 12 แถว" });
  assert.deepEqual(plain(model.purgeSummary({ deleted: 12, total: 3, removed: 3 })), { complete: true, message: "ล้างข้อมูลทดสอบแล้ว 12 แถว · ลบไฟล์ 3 ไฟล์" });
  const partial = model.purgeSummary({ deleted: 12, total: 3, removed: 1 });
  assert.equal(partial.complete, false);
  assert.match(partial.message, /ลบไฟล์ได้ 1 จาก 3 ไฟล์ ยังเหลือ 2 ไฟล์/);
});

/* ---------- error จาก RPC ---------- */
test("errors: Thai database messages are forwarded, technical ones are replaced", () => {
  assert.equal(model.describeError({ code: "23514", message: "ไม่พบใบแจ้งซ่อมนี้" }).message, "ไม่พบใบแจ้งซ่อมนี้");
  assert.equal(model.describeError({ code: "42501", message: "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้" }).forwarded, true);
  assert.equal(model.describeError({ code: "XX000", message: "boom" }).message, "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ");
  assert.equal(model.describeError({ status: 401 }).kind, "session");
  assert.equal(model.describeError({ code: "PGRST202" }).message, "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบแจ้งซ่อม กรุณาแจ้งผู้ดูแลระบบ");
  assert.equal(model.describeError({ message: "Failed to fetch" }, { write: true }).kind, "unknown");
  assert.match(model.describeError({ message: "Failed to fetch" }, { write: true }).message, /ผลไม่แน่ชัด/);
  assert.match(model.describeError({ message: "Failed to fetch" }).message, /โหลดข้อมูลไม่สำเร็จ/);
  assert.equal(model.describeError(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ")).forwarded, true);
  assert.equal(model.describeUploadError({ statusCode: "403" }).kind, "rejected");
  assert.equal(model.describeUploadError({ statusCode: "413" }).message, "ไฟล์ต้องมีขนาดไม่เกิน 20 MB");
  assert.equal(model.describeUploadError({ statusCode: "415" }).message, model.describeUploadError({ message: "invalid mime type" }).message);
  assert.equal(model.describeUploadError({ message: "Failed to fetch" }).kind, "unknown");
  assert.match(model.describeUploadError({ statusCode: "403" }, { comment: true }).message, /หลังส่งข้อความ/);
});
