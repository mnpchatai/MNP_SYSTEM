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
  assert.deepEqual(Object.keys(model.DOCUMENT_STATUSES), ["draft", "approved", "obsolete"]);
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
