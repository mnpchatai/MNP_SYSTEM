import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/factory-master-model.js");
const { listParams, filterItems, paginate, countByType, lowStockItems, bomRequirement, itemPayload, changedFields } = model;

const items = [
  { id: "1", code: "RM-NR-001", name: "ยางธรรมชาติ STR 20", name_en: "Natural rubber", specification: "เกรด STR 20", item_type: "RM", brand: "MNP", status: "active", stock: 1200, min_stock: 500 },
  { id: "2", code: "RM-EVA-001", name: "เม็ดพลาสติก EVA", name_en: "EVA resin", specification: "", item_type: "RM", brand: "SAFSOF", status: "active", stock: 240, min_stock: 300 },
  { id: "3", code: "FG-SAF-001", name: "SAFSOF ลูกบอลโฟม", name_en: "Foam ball", specification: "สีน้ำเงิน", item_type: "FG", brand: "SAFSOF", status: "active", stock: 650, min_stock: 200 },
  { id: "4", code: "RM-EVA-OLD", name: "เม็ด EVA เกรดเดิม", name_en: "Legacy EVA", specification: "", item_type: "RM", brand: "SAFSOF", status: "inactive", stock: 0, min_stock: 10 },
  { id: "5", code: "PKG-BOX-001", name: "กล่องลูกฟูก", name_en: "Box", specification: "", item_type: "PKG", brand: "SAFSOF", status: "active", stock: 0, min_stock: 0 },
];
const params = (query) => new URLSearchParams(query);

test("listParams falls back to safe defaults for unknown or malformed values", () => {
  assert.deepEqual(listParams(params("")), { q: "", type: "all", brand: "all", status: "all", sort: "code", page: 1 });
  assert.deepEqual(listParams(params("type=XX&brand=ACME&status=deleted&sort=price&page=-3")), { q: "", type: "all", brand: "all", status: "all", sort: "code", page: 1 });
  assert.deepEqual(listParams(params("q=%20EVA%20&type=RM&brand=SAFSOF&status=inactive&sort=name&page=2")), { q: "EVA", type: "RM", brand: "SAFSOF", status: "inactive", sort: "name", page: 2 });
  assert.equal(listParams(params(`q=${"x".repeat(300)}`)).q.length, 100, "search text is capped");
  assert.equal(listParams(null).type, "all");
});

test("filterItems searches code, Thai and English names and specification, ignoring case", () => {
  const all = { q: "", type: "all", brand: "all", status: "all", sort: "code" };
  assert.deepEqual(filterItems(items, { ...all, q: "eva" }).map((i) => i.id), ["2", "4"]);
  assert.deepEqual(filterItems(items, { ...all, q: "STR 20" }).map((i) => i.id), ["1"]);
  assert.deepEqual(filterItems(items, { ...all, q: "foam ball" }).map((i) => i.id), ["3"]);
  assert.deepEqual(filterItems(items, { ...all, q: "สีน้ำเงิน" }).map((i) => i.id), ["3"]);
});

test("filterItems combines type, brand and status filters and sorts by code or name", () => {
  const base = { q: "", type: "all", brand: "all", status: "all", sort: "code" };
  assert.deepEqual(filterItems(items, base).map((i) => i.code), ["FG-SAF-001", "PKG-BOX-001", "RM-EVA-001", "RM-EVA-OLD", "RM-NR-001"]);
  assert.deepEqual(filterItems(items, { ...base, type: "RM", brand: "SAFSOF", status: "active" }).map((i) => i.id), ["2"]);
  assert.deepEqual(filterItems(items, { ...base, status: "inactive" }).map((i) => i.id), ["4"]);
  assert.equal(filterItems(items, { ...base, sort: "name" })[0].code, "PKG-BOX-001", "Thai collation puts กล่อง first");
  assert.equal(filterItems(items, base).length, items.length, "filtering never drops the source");
  assert.equal(items[0].id, "1", "filtering does not reorder the source array");
});

test("paginate clamps the page and reports a 1-based range", () => {
  const rows = Array.from({ length: 23 }, (_, n) => n);
  assert.deepEqual(paginate(rows, 1), { rows: rows.slice(0, 10), page: 1, pageCount: 3, total: 23, from: 1, to: 10 });
  assert.deepEqual(paginate(rows, 3).rows, [20, 21, 22]);
  assert.equal(paginate(rows, 99).page, 3, "too-high pages show the last page");
  assert.equal(paginate(rows, 0).page, 1);
  assert.deepEqual(paginate([], 4), { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
});

test("countByType counts every type and the total", () => {
  assert.deepEqual(countByType(items), { all: 5, RM: 3, WIP: 0, FG: 1, PKG: 1 });
  assert.deepEqual(countByType(undefined), { all: 0, RM: 0, WIP: 0, FG: 0, PKG: 0 });
});

test("lowStockItems flags active items below their minimum only", () => {
  assert.deepEqual(lowStockItems(items).map((i) => i.id), ["2"], "inactive and zero-minimum items are not low");
});

test("bomRequirement scales by output quantity and adds scrap on top", () => {
  assert.equal(bomRequirement(3, 2, 100, 100), 3.06);
  assert.ok(Math.abs(bomRequirement(3, 2, 1000, 100) - 30.6) < 1e-9);
  assert.ok(Math.abs(bomRequirement(1.2, 3, 200, 1) - 247.2) < 1e-9);
  assert.equal(bomRequirement(0.06, 0, 1000, 100), 0.6);
  assert.equal(bomRequirement(70, 2, 0, 100), null, "nothing to make");
  assert.equal(bomRequirement(70, 2, -5, 100), null);
  assert.equal(bomRequirement(70, 2, 100, 0), null, "a BOM must yield something");
  assert.equal(bomRequirement(70, 2, Number.NaN, 100), null);
  assert.equal(bomRequirement("70", "2", "100", "100"), 71.4, "numeric strings from JSON are accepted");
});

test("itemPayload normalises a new item from the form", () => {
  const payload = itemPayload({ code: " rm-new-01 ", name: " ยางใหม่ ", name_en: "", item_type: "RM", category_code: "rubber", brand: "MNP", unit_code: "KG", procurement: "buy", status: "active", lot_tracking: "on", min_stock: "12.5", specification: " spec " });
  assert.deepEqual(payload, {
    p_id: null, p_version: null, p_code: "RM-NEW-01", p_name: "ยางใหม่", p_name_en: "", p_item_type: "RM", p_category_code: "rubber",
    p_brand: "MNP", p_unit_code: "KG", p_procurement: "buy", p_status: "active", p_lot_tracking: true, p_min_stock: 12.5, p_specification: "spec",
  });
  assert.equal(itemPayload({ min_stock: "" }).p_min_stock, null, "an empty minimum is sent as missing, not zero");
  assert.equal(itemPayload({}).p_lot_tracking, false, "an unticked checkbox is false");
});

test("itemPayload keeps locked fields from the stored item when editing", () => {
  const existing = { id: "abc", version: 4, item_type: "FG", unit_code: "PCS", lot_tracking: true };
  const payload = itemPayload({ code: "fg-1", name: "x", item_type: "RM", unit_code: "KG", category_code: "toy", brand: "SAFSOF", procurement: "make", status: "inactive", min_stock: "0" }, existing);
  assert.equal(payload.p_id, "abc");
  assert.equal(payload.p_version, 4);
  assert.equal(payload.p_item_type, "FG", "type cannot be changed from the form");
  assert.equal(payload.p_unit_code, "PCS", "base unit cannot be changed from the form");
  assert.equal(payload.p_lot_tracking, true, "lot tracking cannot be changed from the form");
  assert.equal(payload.p_status, "inactive");
  assert.equal(payload.p_min_stock, 0);
});

test("labels cover every value allowed by the database checks", () => {
  assert.deepEqual(Object.keys(model.ITEM_TYPES), ["RM", "WIP", "FG", "PKG"]);
  assert.deepEqual(Object.keys(model.PROCUREMENT), ["buy", "make", "both"]);
  assert.deepEqual([...model.BRANDS], ["MNP", "SAFSOF"]);
  assert.deepEqual(Object.keys(model.STATUSES), ["active", "inactive"]);
  assert.deepEqual(Object.keys(model.PRODUCTION_STATUSES), ["planned", "released", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(Object.keys(model.DOCUMENT_STATUSES), ["draft", "pending_approval", "approved", "obsolete"]);
  assert.ok(new RegExp(`^${model.ITEM_CODE_PATTERN}$`, "v").test("RM-NR_001"), "the HTML pattern compiles with the v flag browsers use");
  assert.ok(!new RegExp(`^${model.ITEM_CODE_PATTERN}$`, "v").test("BAD CODE"));
});

test("changedFields lists edited fields only, comparing numbers by value", () => {
  const before = { code: "A-01", name: "เดิม", name_en: "", category_code: "rubber", brand: "MNP", procurement: "buy", status: "active", min_stock: "10.000", specification: "", version: 1, updated_at: "t1" };
  assert.deepEqual(changedFields(before, { ...before, min_stock: 10, version: 2, updated_at: "t2" }), [], "version and timestamps are not user edits");
  assert.deepEqual(changedFields(before, { ...before, name: "ใหม่", status: "inactive", min_stock: 25 }), ["name", "status", "min_stock"]);
  assert.deepEqual(changedFields(null, before), [], "a creation has no before snapshot");
  assert.deepEqual(changedFields(before, undefined), []);
});

// ---------- โครงสร้างสินค้า (BOM): ฉบับร่าง → ส่งขออนุมัติ → อนุมัติ ----------
const bomItems = [
  { id: "fg1", code: "FG-1", name: "สินค้า 1", item_type: "FG", procurement: "make", status: "active", unit_code: "PCS" },
  { id: "fg2", code: "FG-2", name: "สินค้า 2", item_type: "FG", procurement: "both", status: "active", unit_code: "SET" },
  { id: "fg3", code: "FG-3", name: "ซื้อมา", item_type: "FG", procurement: "buy", status: "active", unit_code: "PCS" },
  { id: "wip1", code: "WIP-1", name: "ระหว่างผลิต", item_type: "WIP", procurement: "make", status: "active", unit_code: "KG" },
  { id: "wip2", code: "WIP-2", name: "หยุดใช้", item_type: "WIP", procurement: "make", status: "inactive", unit_code: "KG" },
  { id: "rm1", code: "RM-1", name: "วัตถุดิบ", item_type: "RM", procurement: "buy", status: "active", unit_code: "KG" },
  { id: "rm2", code: "RM-2", name: "วัตถุดิบเก่า", item_type: "RM", procurement: "buy", status: "inactive", unit_code: "KG" },
  { id: "pkg1", code: "PKG-1", name: "กล่อง", item_type: "PKG", procurement: "buy", status: "active", unit_code: "PCS" },
];
const bomRows = [
  { id: "b1", item_id: "fg1", code: "FG-1", revision: "A", status: "approved", submitted_at: null, updated_at: "2026-10-01T00:00:00Z" },
  { id: "b2", item_id: "fg1", code: "FG-1", revision: "B", status: "pending_approval", submitted_at: "2026-10-06T09:00:00Z", updated_at: "2026-10-06T09:00:00Z" },
  { id: "b3", item_id: "wip1", code: "WIP-1", revision: "A", status: "draft", decision_note: "", submitted_at: null, updated_at: "2026-10-05T00:00:00Z" },
  { id: "b4", item_id: "fg2", code: "FG-2", revision: "A", status: "draft", decision_note: "ผิดสัดส่วน", submitted_at: null, updated_at: "2026-10-02T00:00:00Z" },
  { id: "b5", item_id: "pkg1", code: "PKG-1", revision: "A", status: "obsolete", submitted_at: null, updated_at: "2026-09-01T00:00:00Z" },
  { id: "b6", item_id: "rm1", code: "RM-1", revision: "A", status: "pending_approval", submitted_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T09:00:00Z" },
];

test("canOwnBom accepts only active WIP/FG items that are made in house", () => {
  assert.deepEqual(bomItems.filter(model.canOwnBom).map((i) => i.id), ["fg1", "fg2", "wip1"]);
  assert.equal(model.canOwnBom(undefined), false);
  assert.equal(model.canOwnBom({ status: "active", item_type: "RM", procurement: "make" }), false, "raw material cannot own a BOM");
});

test("bomParentChoices separates items free to start a BOM from items that already have an open revision", () => {
  const { available, blocked } = model.bomParentChoices(bomItems, bomRows);
  assert.deepEqual(available.map((i) => i.id), [], "fg1 has a pending revision, fg2 and wip1 have drafts");
  assert.deepEqual(blocked.map(({ item, bom }) => [item.id, bom.id]), [["fg1", "b2"], ["fg2", "b4"], ["wip1", "b3"]], "sorted by code");
  const onlyApproved = model.bomParentChoices(bomItems, bomRows.filter((b) => b.id === "b1" || b.id === "b5"));
  assert.deepEqual(onlyApproved.available.map((i) => i.id), ["fg1", "fg2", "wip1"], "an approved or obsolete revision does not block a new one");
  assert.deepEqual(model.bomParentChoices(undefined, undefined), { available: [], blocked: [] });
});

test("componentChoices lists active items except the parent, sorted by code", () => {
  assert.deepEqual(model.componentChoices(bomItems, "fg1").map((i) => i.id), ["fg2", "fg3", "pkg1", "rm1", "wip1"]);
  assert.deepEqual(model.componentChoices(bomItems, "").length, 6, "no parent selected yet: every active item");
  assert.deepEqual(model.componentChoices(undefined, "x"), []);
});

test("bomPayload normalises the form, drops blank rows and sends missing numbers as null", () => {
  const payload = model.bomPayload({
    item_id: " fg1 ", output_qty: "12", effective_date: "2026-10-07", note: "  โน้ต  ",
    lines: [
      { component_id: "rm1", quantity: "2.5", scrap_percent: "1.5" },
      { component_id: "", quantity: "", scrap_percent: "" },
      { component_id: "pkg1", quantity: "", scrap_percent: "" },
      { component_id: "", quantity: "3", scrap_percent: "" },
    ],
  }, null);
  assert.deepEqual(payload, {
    p_id: null, p_version: null, p_item_id: "fg1", p_output_qty: 12, p_effective_date: "2026-10-07", p_note: "โน้ต",
    p_lines: [
      { component_id: "rm1", quantity: 2.5, scrap_percent: 1.5 },
      { component_id: "pkg1", quantity: null, scrap_percent: 0 },
      { component_id: "", quantity: 3, scrap_percent: 0 },
    ],
  });
  assert.equal(model.bomPayload({ item_id: "", output_qty: "", effective_date: "", lines: [] }, null).p_item_id, null);
  assert.equal(model.bomPayload({ output_qty: "" }, null).p_output_qty, null, "an empty output is missing, not zero");
  assert.equal(model.bomPayload({ effective_date: "" }, null).p_effective_date, null);
});

test("bomPayload keeps the stored parent and version when editing a draft", () => {
  const payload = model.bomPayload({ item_id: "fg2", output_qty: "1", effective_date: "2026-10-07", lines: [] }, { id: "b3", version: 4, item_id: "wip1" });
  assert.equal(payload.p_id, "b3");
  assert.equal(payload.p_version, 4);
  assert.equal(payload.p_item_id, "wip1", "the parent cannot be changed from the form");
});

const goodPayload = () => ({
  p_id: null, p_version: null, p_item_id: "fg1", p_output_qty: 10, p_effective_date: "2026-10-07", p_note: "",
  p_lines: [{ component_id: "rm1", quantity: 2, scrap_percent: 1 }, { component_id: "pkg1", quantity: 1, scrap_percent: 0 }],
});

test("validateBomPayload accepts a good payload", () => {
  assert.deepEqual(model.validateBomPayload(goodPayload(), bomItems), []);
  assert.deepEqual(model.validateBomPayload({ ...goodPayload(), p_lines: [] }, bomItems), [], "an empty draft can be saved");
});

test("validateBomPayload requires a line only when submitting", () => {
  const empty = { ...goodPayload(), p_lines: [] };
  assert.deepEqual(model.validateBomPayload(empty, bomItems, { requireLines: true }), ["ต้องมีส่วนประกอบอย่างน้อย 1 บรรทัดก่อนส่งขออนุมัติ"]);
});

test("validateBomPayload rejects bad parents and headers", () => {
  const messages = (changes) => model.validateBomPayload({ ...goodPayload(), ...changes }, bomItems);
  assert.match(messages({ p_item_id: null })[0], /เลือกสินค้าหลัก/);
  for (const id of ["rm1", "pkg1", "fg3", "wip2", "ghost"]) assert.match(messages({ p_item_id: id })[0], /สินค้าหลักต้องเป็น Item/, id);
  for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.00001, 1000000001]) assert.match(messages({ p_output_qty: value })[0], /ผลผลิตต่อสูตร/, String(value));
  assert.deepEqual(messages({ p_output_qty: 0.0001 }), [], "the smallest storable quantity is fine");
  assert.match(messages({ p_effective_date: null })[0], /วันที่เริ่มมีผล/);
  assert.match(messages({ p_note: "x".repeat(1001) })[0], /หมายเหตุ/);
});

test("validateBomPayload names the offending line", () => {
  const withLines = (p_lines) => model.validateBomPayload({ ...goodPayload(), p_lines }, bomItems);
  assert.deepEqual(withLines([{ component_id: "", quantity: 1, scrap_percent: 0 }]), ["บรรทัด 1: กรุณาเลือกส่วนประกอบ"]);
  assert.match(withLines([{ component_id: "rm2", quantity: 1, scrap_percent: 0 }])[0], /บรรทัด 1: ส่วนประกอบต้องเป็น Item ที่ใช้งานอยู่/);
  assert.match(withLines([{ component_id: "ghost", quantity: 1, scrap_percent: 0 }])[0], /บรรทัด 1: ส่วนประกอบต้องเป็น Item ที่ใช้งานอยู่/);
  assert.match(withLines([{ component_id: "fg1", quantity: 1, scrap_percent: 0 }])[0], /บรรทัด 1: ส่วนประกอบเป็นสินค้าหลักเองไม่ได้/);
  assert.match(withLines([{ component_id: "rm1", quantity: 1, scrap_percent: 0 }, { component_id: "rm1", quantity: 2, scrap_percent: 0 }])[0], /บรรทัด 2: ส่วนประกอบ RM-1 ซ้ำ/);
  for (const quantity of [null, 0, -3, Number.NaN, 0.00004, 1000000001]) {
    assert.match(withLines([{ component_id: "rm1", quantity, scrap_percent: 0 }])[0], /บรรทัด 1: ปริมาณ/, String(quantity));
  }
  for (const scrap of [-0.01, 100, 99.999, Number.NaN]) {
    assert.match(withLines([{ component_id: "rm1", quantity: 1, scrap_percent: scrap }])[0], /บรรทัด 1: เผื่อสูญเสีย/, String(scrap));
  }
  assert.deepEqual(withLines([{ component_id: "rm1", quantity: 1, scrap_percent: 99.99 }]), [], "99.99% is the largest allowed scrap");
  assert.match(withLines(Array.from({ length: 101 }, () => ({ component_id: "rm1", quantity: 1, scrap_percent: 0 })))[0], /ไม่เกิน 100 บรรทัด/);
});

test("bomActions follows the status workflow", () => {
  assert.deepEqual(model.bomActions({ status: "draft" }), ["edit", "submit"]);
  assert.deepEqual(model.bomActions({ status: "pending_approval" }), ["withdraw", "approve", "reject"]);
  assert.deepEqual(model.bomActions({ status: "approved" }), ["revise"]);
  assert.deepEqual(model.bomActions({ status: "obsolete" }), []);
  assert.deepEqual(model.bomActions(null), []);
  assert.deepEqual(model.bomActions({ status: "whatever" }), []);
});

test("pendingBoms lists the oldest submission first and nothing else", () => {
  assert.deepEqual(model.pendingBoms(bomRows).map((b) => b.id), ["b6", "b2"]);
  assert.deepEqual(model.pendingBoms(undefined), []);
});

test("draftBoms puts returned drafts first, then the most recently edited", () => {
  assert.deepEqual(model.draftBoms(bomRows).map((b) => b.id), ["b4", "b3"]);
});

test("countBomsByStatus always has a key for every status", () => {
  assert.deepEqual(model.countBomsByStatus(bomRows), { draft: 2, pending_approval: 2, approved: 1, obsolete: 1 });
  assert.deepEqual(model.countBomsByStatus([]), { draft: 0, pending_approval: 0, approved: 0, obsolete: 0 });
  assert.deepEqual(model.countBomsByStatus([{ status: "mystery" }]), { draft: 0, pending_approval: 0, approved: 0, obsolete: 0 }, "unknown statuses are ignored");
});

test("bomTimeline shows one BOM's history oldest first", () => {
  const history = [{ id: 3, bom_id: "b2" }, { id: 2, bom_id: "b1" }, { id: 1, bom_id: "b2" }];
  assert.deepEqual(model.bomTimeline(history, "b2").map((e) => e.id), [1, 3]);
  assert.deepEqual(model.bomTimeline(history, "zzz"), []);
  assert.equal(history[0].id, 3, "the source order is untouched");
});

test("history action labels cover every action the database records", () => {
  assert.deepEqual(Object.keys(model.BOM_HISTORY_ACTIONS), ["create", "update", "submit", "withdraw", "approve", "reject", "obsolete"]);
});
