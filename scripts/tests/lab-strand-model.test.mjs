import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// โมเดลข้อมูลยางเส้นของ MNP LAB เป็นข้อมูลล้วน (ไม่มี DOM/Supabase) โหลดตรงๆ ได้
const require = createRequire(import.meta.url);
const strand = require("../../modules/lab-strand-model.js");

const rpcRow = (overrides = {}) => ({
  sample_id: "111", order_no: "PO-2610-001", outer_mm: 20.1, inner_mm: 3.05, outer_min_mm: 19.5, outer_max_mm: 20.5,
  inner_min_mm: 2.5, inner_max_mm: 3.5, version: 2, updated_at: "2026-10-19T03:00:00Z", ...overrides,
});

test("normalizeSpec maps an RPC row and keeps empty fields as null", () => {
  assert.deepEqual(strand.normalizeSpec(rpcRow()), {
    sampleId: "111", orderNo: "PO-2610-001", outer: 20.1, inner: 3.05, outerMin: 19.5, outerMax: 20.5,
    innerMin: 2.5, innerMax: 3.5, version: 2, updatedAt: "2026-10-19T03:00:00Z",
  });
  const sparse = strand.normalizeSpec({ sample_id: "7", order_no: null, outer_mm: null, version: "3" });
  assert.equal(sparse.sampleId, "7");
  assert.equal(sparse.orderNo, null);
  assert.equal(sparse.outer, null);
  assert.equal(sparse.version, 3);
  assert.equal(strand.normalizeSpec({ sample_id: "  " }), null, "a row without an ID is dropped");
  assert.equal(strand.normalizeSpec(null), null);
  assert.equal(strand.normalizeSpec({ sample_id: "1", version: "x" }).version, 1, "an unreadable version falls back to 1");
});

test("normalizeList sorts IDs numerically and rejects anything that is not a list", () => {
  const list = strand.normalizeList([rpcRow({ sample_id: "112" }), rpcRow({ sample_id: "9" }), { sample_id: "" }, rpcRow({ sample_id: "111" })]);
  assert.deepEqual(list.map((item) => item.sampleId), ["9", "111", "112"]);
  assert.equal(strand.normalizeList({ materials: [] }), null);
  assert.equal(strand.normalizeList(null), null);
  assert.deepEqual(strand.normalizeList([]), []);
});

test("upsert, remove and find return new lists without touching the old one", () => {
  const base = strand.normalizeList([rpcRow({ sample_id: "1" }), rpcRow({ sample_id: "3" })]);
  const added = strand.upsert(base, strand.normalizeSpec(rpcRow({ sample_id: "2" })));
  assert.deepEqual(added.map((item) => item.sampleId), ["1", "2", "3"]);
  assert.equal(base.length, 2);
  const replaced = strand.upsert(added, strand.normalizeSpec(rpcRow({ sample_id: "2", order_no: "NEW", version: 5 })));
  assert.equal(replaced.length, 3);
  assert.equal(strand.find(replaced, "2").orderNo, "NEW");
  assert.deepEqual(strand.remove(replaced, "2").map((item) => item.sampleId), ["1", "3"]);
  assert.equal(strand.find(base, "9"), null);
});

test("signature changes when a record is added, removed or edited (version bump)", () => {
  const base = strand.normalizeList([rpcRow({ sample_id: "1", version: 1 })]);
  const sig = strand.signature(base);
  assert.equal(strand.signature(strand.normalizeList([rpcRow({ sample_id: "1", version: 1 })])), sig);
  assert.notEqual(strand.signature(strand.normalizeList([rpcRow({ sample_id: "1", version: 2 })])), sig);
  assert.notEqual(strand.signature(strand.normalizeList([rpcRow({ sample_id: "1" }), rpcRow({ sample_id: "2" })])), sig);
  assert.notEqual(
    strand.signature(strand.normalizeList([rpcRow({ sample_id: "1", version: 1, updated_at: "2026-10-19T01:00:00Z" })])),
    strand.signature(strand.normalizeList([rpcRow({ sample_id: "1", version: 1, updated_at: "2026-10-19T02:00:00Z" })])),
    "a record deleted and re-added by someone else can land on the same version; its timestamp still differs",
  );
  assert.equal(strand.signature([]), "");
});

test("idsWithoutData keeps only IDs that have no record yet", () => {
  const ids = [{ id: "111", count: 3 }, { id: "112", count: 1 }, { id: "113", count: 2 }];
  const list = strand.normalizeList([rpcRow({ sample_id: "112" })]);
  assert.deepEqual(strand.idsWithoutData(ids, list).map((entry) => entry.id), ["111", "113"]);
  assert.deepEqual(strand.idsWithoutData(ids, []).length, 3);
});

test("specStatus compares a measurement to the spec window, including one-sided specs and values on the edge", () => {
  assert.equal(strand.specStatus(20, 19.5, 20.5), "ok");
  assert.equal(strand.specStatus(19.5, 19.5, 20.5), "ok", "the lower limit itself is in spec");
  assert.equal(strand.specStatus(20.5, 19.5, 20.5), "ok", "the upper limit itself is in spec");
  assert.equal(strand.specStatus(19.49, 19.5, 20.5), "low");
  assert.equal(strand.specStatus(20.51, 19.5, 20.5), "high");
  assert.equal(strand.specStatus(0.1 + 0.2, 0.3, 0.3), "ok", "floating point noise does not push an edge value out of spec");
  assert.equal(strand.specStatus(21, null, 20.5), "high");
  assert.equal(strand.specStatus(21, null, 21), "ok");
  assert.equal(strand.specStatus(14, 14.5, null), "low");
  assert.equal(strand.specStatus(20, null, null), null, "no limits means no verdict");
  assert.equal(strand.specStatus(null, 19.5, 20.5), null, "no measurement means no verdict");
});

test("formatSize and formatLimits show two decimals, one-sided limits and a dash for nothing", () => {
  assert.equal(strand.formatSize(20.1), "20.10");
  assert.equal(strand.formatSize(3), "3.00");
  assert.equal(strand.formatSize(null), "—");
  assert.equal(strand.formatLimits(19.5, 20.5), "19.50 – 20.50");
  assert.equal(strand.formatLimits(19.5, null), "≥ 19.50");
  assert.equal(strand.formatLimits(null, 20.5), "≤ 20.50");
  assert.equal(strand.formatLimits(null, null), "—");
});

test("parseSize accepts up to two decimals (dot or comma) and rejects everything else without rounding", () => {
  assert.deepEqual(strand.parseSize(""), { value: null });
  assert.deepEqual(strand.parseSize("   "), { value: null });
  assert.deepEqual(strand.parseSize(" 20.1 "), { value: 20.1 });
  assert.deepEqual(strand.parseSize("20,15"), { value: 20.15 });
  assert.deepEqual(strand.parseSize("3"), { value: 3 });
  assert.deepEqual(strand.parseSize("99999.99"), { value: 99999.99 });
  for (const bad of ["0", "0.00", "-1", "+1", "20.123", "20.", ".5", "1e3", "abc", "20 mm", "1,000.50", "100000", "NaN", "Infinity"]) {
    assert.deepEqual(strand.parseSize(bad), { error: true }, `"${bad}" is not a valid size`);
  }
});

const form = (overrides = {}) => ({
  material: "A1802", sampleId: "111", orderNo: "PO-2610-001", outer: "20.10", inner: "3.05",
  outerMin: "19.5", outerMax: "20.5", innerMin: "2.5", innerMax: "3.5", ...overrides,
});

test("buildSaveParams turns form text into RPC arguments", () => {
  assert.deepEqual(strand.buildSaveParams(form()), {
    params: {
      p_material: "A1802", p_sample_id: "111", p_order_no: "PO-2610-001", p_outer_mm: 20.1, p_inner_mm: 3.05,
      p_outer_min_mm: 19.5, p_outer_max_mm: 20.5, p_inner_min_mm: 2.5, p_inner_max_mm: 3.5, p_expected_version: null,
    },
  });
  const edit = strand.buildSaveParams(form({ expectedVersion: 4, orderNo: "  PO-9  ", outer: "", inner: "", outerMin: "", outerMax: "21", innerMin: "", innerMax: "" }));
  assert.equal(edit.params.p_expected_version, 4);
  assert.equal(edit.params.p_order_no, "PO-9", "the order number is trimmed");
  assert.equal(edit.params.p_outer_mm, null);
  assert.equal(edit.params.p_outer_max_mm, 21, "a one-sided spec is accepted");
  assert.equal(edit.params.p_outer_min_mm, null);
  assert.equal(strand.buildSaveParams(form({ orderNo: "", outer: "", inner: "", outerMin: "", outerMax: "", innerMin: "20", innerMax: "" })).params.p_order_no, null);
});

test("buildSaveParams reports the same error codes the database raises", () => {
  assert.equal(strand.buildSaveParams(form({ sampleId: "  " })).error, "LAB_INVALID_SAMPLE");
  assert.equal(strand.buildSaveParams(form({ orderNo: "P".repeat(61) })).error, "LAB_INVALID_ORDER");
  assert.equal(strand.buildSaveParams(form({ orderNo: "P".repeat(60) })).error, undefined, "60 characters is the limit");
  assert.equal(strand.buildSaveParams(form({ outer: "20.123" })).error, "LAB_INVALID_SIZE");
  assert.equal(strand.buildSaveParams(form({ innerMax: "abc" })).error, "LAB_INVALID_SIZE");
  assert.equal(strand.buildSaveParams(form({ outerMin: "20.5", outerMax: "19.5" })).error, "LAB_INVALID_SPEC_RANGE");
  assert.equal(strand.buildSaveParams(form({ innerMin: "3.5", innerMax: "2.5" })).error, "LAB_INVALID_SPEC_RANGE");
  assert.equal(strand.buildSaveParams(form({ outerMin: "20", outerMax: "20" })).error, undefined, "equal limits are allowed");
  assert.equal(strand.buildSaveParams(form({ orderNo: " ", outer: "", inner: "", outerMin: "", outerMax: "", innerMin: "", innerMax: "" })).error, "LAB_SPEC_EMPTY");
  for (const code of ["LAB_INVALID_SAMPLE", "LAB_SAMPLE_NOT_FOUND", "LAB_INVALID_ORDER", "LAB_INVALID_SIZE", "LAB_INVALID_SPEC_RANGE", "LAB_SPEC_EMPTY", "LAB_SPEC_CONFLICT"]) {
    assert.match(strand.ERROR_MESSAGES[code], /\S/, `${code} has a user-facing message`);
  }
});

test("isMissingFunction recognises a database that has not applied the migration yet", () => {
  assert.equal(strand.isMissingFunction({ code: "PGRST202", message: "x" }), true);
  assert.equal(strand.isMissingFunction({ message: "Could not find the function public.app_lab_strand_specs(p_material) in the schema cache" }), true);
  assert.equal(strand.isMissingFunction({ message: "NOT_AUTHORIZED" }), false);
  assert.equal(strand.isMissingFunction(null), false);
});

test("IDs are passed through exactly as stored, so JS and PostgreSQL never disagree about which ID a row belongs to", () => {
  // JS trim() also strips NBSP and tabs but PostgreSQL btrim() strips only spaces; an ID is therefore never re-trimmed here
  assert.equal(strand.normalizeSpec({ sample_id: "111\u00a0" }).sampleId, "111\u00a0");
  assert.equal(strand.buildSaveParams(form({ sampleId: "111\u00a0" })).params.p_sample_id, "111\u00a0");
  assert.equal(strand.buildSaveParams(form({ sampleId: "\u00a0 " })).error, "LAB_INVALID_SAMPLE", "an ID with nothing in it is still refused");
});
