import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/lab-mooney-model.js");

const overviewFixture = {
  synced_at: "2026-10-16T03:30:00+00:00",
  materials: [
    { material: "A2004", result_count: 154, test_days: 6, first_tested: "2026-09-14", last_tested: "2026-10-02" },
    { material: "A1802", result_count: 18, test_days: 1, first_tested: "2026-09-21", last_tested: "2026-09-21" },
    { material: "B0005", result_count: 156, test_days: 9, first_tested: "2026-09-12", last_tested: "2026-10-02" },
    { material: "B0005N", result_count: 8, test_days: 1, first_tested: "2026-09-21", last_tested: "2026-09-21" },
    { material: "c13011", result_count: 3, test_days: 1, first_tested: "2026-09-10", last_tested: "2026-09-10" },
  ],
};

test("a material in the URL is trimmed, length-limited and optional", () => {
  assert.equal(model.readMaterial("  A1802 "), "A1802");
  assert.equal(model.readMaterial("E00030S T"), "E00030S T");
  assert.equal(model.readMaterial(""), null);
  assert.equal(model.readMaterial("   "), null);
  assert.equal(model.readMaterial(null), null);
  assert.equal(model.readMaterial("x".repeat(model.MAX_MATERIAL_LENGTH)), "x".repeat(model.MAX_MATERIAL_LENGTH));
  assert.equal(model.readMaterial("x".repeat(model.MAX_MATERIAL_LENGTH + 1)), null);
});

test("material links are encoded so names with spaces or symbols stay in one query value", () => {
  assert.equal(model.materialUrl("A1802"), "#/lab?material=A1802");
  assert.equal(model.materialUrl("E00030S T"), "#/lab?material=E00030S%20T");
  assert.equal(model.materialUrl("a&b=c#d"), "#/lab?material=a%26b%3Dc%23d");
  assert.equal(model.materialUrl(""), "#/lab");
});

test("the overview is normalised to numbers and camelCase, dropping nameless rows", () => {
  const overview = model.normalizeOverview({
    synced_at: "2026-10-16T03:30:00+00:00",
    materials: [{ material: "A1802", result_count: "18", test_days: 1, first_tested: "2026-09-21", last_tested: "2026-09-21" }, { material: "" }, null],
  });
  assert.deepEqual(overview.materials, [{ material: "A1802", resultCount: 18, testDays: 1, firstTested: "2026-09-21", lastTested: "2026-09-21" }]);
  assert.equal(overview.syncedAt, "2026-10-16T03:30:00+00:00");
  assert.deepEqual(model.normalizeOverview(null), { syncedAt: null, materials: [] });
  assert.deepEqual(model.normalizeOverview({ materials: "oops" }).materials, []);
});

test("result rows keep blanks as null and never turn them into zero", () => {
  const [row] = model.normalizeResults([{
    id: "r1", sample_id: "111", test_date: "2026-09-21", test_time: "08:29:13", temperature_c: 100, test_minutes: 4,
    mh: 50.79, mv: "31.39", avg_mh: null, sd_mh: null, avg_mv: undefined, sd_mv: "",
  }]);
  assert.deepEqual(row, {
    id: "r1", sampleId: "111", testDate: "2026-09-21", testTime: "08:29:13", temperature: 100, testMinutes: 4,
    mh: 50.79, mv: 31.39, avgMh: null, sdMh: null, avgMv: null, sdMv: null,
  });
  assert.deepEqual(model.normalizeResults(null), []);
});

test("search is case-insensitive and matches anywhere in the material name", () => {
  const { materials } = model.normalizeOverview(overviewFixture);
  assert.deepEqual(model.filterMaterials(materials, "b000").map((item) => item.material), ["B0005", "B0005N"]);
  assert.deepEqual(model.filterMaterials(materials, "  C130 ").map((item) => item.material), ["c13011"]);
  assert.equal(model.filterMaterials(materials, "").length, materials.length);
  assert.equal(model.filterMaterials(materials, "zzz").length, 0);
});

test("materials sort by latest test, name (numeric-aware) or result count, and unknown keys fall back to latest", () => {
  const { materials } = model.normalizeOverview(overviewFixture);
  const names = (key) => model.sortMaterials(materials, key).map((item) => item.material);
  assert.deepEqual(names("recent"), ["A2004", "B0005", "A1802", "B0005N", "c13011"]);
  assert.deepEqual(names("name"), ["A1802", "A2004", "B0005", "B0005N", "c13011"]);
  assert.deepEqual(names("count"), ["B0005", "A2004", "A1802", "B0005N", "c13011"]);
  assert.deepEqual(names("nonsense"), names("recent"));
  assert.equal(materials[0].material, "A2004", "sorting does not reorder the input");
  assert.deepEqual(model.SORT_OPTIONS.map((option) => option.key), ["recent", "name", "count"]);
});

test("the summary totals the rows and finds the newest test date", () => {
  const { materials } = model.normalizeOverview(overviewFixture);
  assert.deepEqual(model.summarize(materials), { materialCount: 5, resultCount: 339, lastTested: "2026-10-02" });
  assert.deepEqual(model.summarize([]), { materialCount: 0, resultCount: 0, lastTested: null });
});

test("dates, times and readings are shown the way the spreadsheet shows them", () => {
  assert.equal(model.formatDate("2026-09-21"), "21/09/2026");
  assert.equal(model.formatDate("2026-10-09"), "09/10/2026");
  assert.equal(model.formatDate(null), "—");
  assert.equal(model.formatDate("21/09/2026"), "—", "only ISO dates are accepted");
  assert.equal(model.formatTime("08:29:13"), "08:29:13");
  assert.equal(model.formatTime("08:29:13.500"), "08:29:13");
  assert.equal(model.formatTime(null), "—");
  assert.equal(model.formatReading(49.9), "49.90");
  assert.equal(model.formatReading(0), "0.00");
  assert.equal(model.formatReading(null), "—");
  assert.equal(model.formatPlain(100), "100");
  assert.equal(model.formatPlain(4.5), "4.5");
  assert.equal(model.formatPlain(null), "—");
});

test("the sync time is shown in Bangkok time", () => {
  assert.equal(model.formatSyncedAt("2026-10-16T03:30:00+00:00"), "16/10/2026 10:30");
  assert.equal(model.formatSyncedAt("2026-10-16T18:05:00Z"), "17/10/2026 01:05", "crosses midnight into the next Bangkok day");
  assert.equal(model.formatSyncedAt(null), "—");
  assert.equal(model.formatSyncedAt("not a date"), "—");
});
