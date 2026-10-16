import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/lab-mooney-model.js");

// สรุปรายวัสดุในรูปที่ buildOverview คืน (ใช้ทดสอบค้นหา/เรียง/สรุป)
const materials = [
  { material: "A2004", resultCount: 154, testDays: 6, firstTested: "2026-09-14", lastTested: "2026-10-02" },
  { material: "A1802", resultCount: 18, testDays: 1, firstTested: "2026-09-21", lastTested: "2026-09-21" },
  { material: "B0005", resultCount: 156, testDays: 9, firstTested: "2026-09-12", lastTested: "2026-10-02" },
  { material: "B0005N", resultCount: 8, testDays: 1, firstTested: "2026-09-21", lastTested: "2026-09-21" },
  { material: "c13011", resultCount: 3, testDays: 1, firstTested: "2026-09-10", lastTested: "2026-09-10" },
];

const feedRow = (overrides = {}) => ({
  source_sheet: "A1802", sample_id: "111", material: "A1802", test_date: "2026-09-21", test_time: "08:29:13",
  temperature_c: 100, test_minutes: 4, mh: 50.79, mv: 31.39, avg_mh: 50.33, sd_mh: 0.45, avg_mv: 31.52, sd_mv: 0.21,
  ...overrides,
});

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

test("the live feed is normalised: numbers or null, camelCase, rows without material or date dropped", () => {
  const feed = model.normalizeFeed({
    ok: true,
    generated_at: "2026-10-16T03:30:05+00:00",
    rows: [
      feedRow({ mv: "31.39", avg_mh: null, sd_mh: undefined, avg_mv: "", sd_mv: null }),
      feedRow({ material: "  " }),
      feedRow({ test_date: null }),
      null,
    ],
    problem_count: "2",
    problems: ["A แถว 2: เวลาไม่ถูกต้อง", 5],
    skipped: ["Summary"],
  });
  assert.equal(feed.generatedAt, "2026-10-16T03:30:05+00:00");
  assert.equal(feed.rows.length, 1);
  assert.deepEqual(feed.rows[0], {
    id: "A1802|111|2026-09-21|08:29:13", material: "A1802", sampleId: "111", testDate: "2026-09-21", testTime: "08:29:13",
    temperature: 100, testMinutes: 4, mh: 50.79, mv: 31.39, avgMh: null, sdMh: null, avgMv: null, sdMv: null,
  });
  assert.equal(feed.problemCount, 2);
  assert.deepEqual(feed.problems, ["A แถว 2: เวลาไม่ถูกต้อง", "5"]);
  assert.deepEqual(feed.skipped, ["Summary"]);
  assert.deepEqual(model.normalizeFeed(null), { generatedAt: null, rows: [], problemCount: 0, problems: [], skipped: [] });
  assert.deepEqual(model.normalizeFeed({ rows: "oops" }).rows, []);
});

test("the overview is built from the rows: counts, distinct test days, first and last test date", () => {
  const { rows } = model.normalizeFeed({ rows: [
    feedRow({ sample_id: "111", test_date: "2026-09-21" }),
    feedRow({ sample_id: "112", test_date: "2026-09-21" }),
    feedRow({ sample_id: "113", test_date: "2026-10-02" }),
    feedRow({ material: "B0005", source_sheet: "B0005", test_date: "2026-09-12" }),
  ] });
  const overview = model.buildOverview(rows);
  assert.deepEqual(overview.find((item) => item.material === "A1802"), {
    material: "A1802", resultCount: 3, firstTested: "2026-09-21", lastTested: "2026-10-02", testDays: 2,
  });
  assert.deepEqual(overview.find((item) => item.material === "B0005"), {
    material: "B0005", resultCount: 1, firstTested: "2026-09-12", lastTested: "2026-09-12", testDays: 1,
  });
  assert.equal(overview.length, 2);
  assert.deepEqual(model.buildOverview([]), []);
});

test("one material's results are newest first (date, then time), ties by ID, and unknown or blank names give nothing", () => {
  const { rows } = model.normalizeFeed({ rows: [
    feedRow({ sample_id: "111", test_date: "2026-09-21", test_time: "08:29:13" }),
    feedRow({ sample_id: "113", test_date: "2026-09-21", test_time: "08:42:31" }),
    feedRow({ sample_id: "9", test_date: "2026-09-21", test_time: "08:36:01" }),
    feedRow({ sample_id: "10", test_date: "2026-09-21", test_time: "08:36:01" }),
    feedRow({ sample_id: "201", test_date: "2026-10-02", test_time: "07:00:00" }),
    feedRow({ material: "B0005", source_sheet: "B0005", sample_id: "111" }),
  ] });
  assert.deepEqual(model.resultsFor(rows, "A1802").map((row) => row.sampleId), ["201", "113", "9", "10", "111"]);
  assert.deepEqual(model.resultsFor(rows, "  A1802 ").length, 5, "the name is trimmed");
  assert.equal(model.resultsFor(rows, "NOPE").length, 0);
  assert.equal(model.resultsFor(rows, "").length, 0);
  assert.equal(rows.length, 6, "the input is not reordered or consumed");
});

test("search is case-insensitive and matches anywhere in the material name", () => {
  assert.deepEqual(model.filterMaterials(materials, "b000").map((item) => item.material), ["B0005", "B0005N"]);
  assert.deepEqual(model.filterMaterials(materials, "  C130 ").map((item) => item.material), ["c13011"]);
  assert.equal(model.filterMaterials(materials, "").length, materials.length);
  assert.equal(model.filterMaterials(materials, "zzz").length, 0);
});

test("materials sort by latest test, name (numeric-aware) or result count, and unknown keys fall back to latest", () => {
  const names = (key) => model.sortMaterials(materials, key).map((item) => item.material);
  assert.deepEqual(names("recent"), ["A2004", "B0005", "A1802", "B0005N", "c13011"]);
  assert.deepEqual(names("name"), ["A1802", "A2004", "B0005", "B0005N", "c13011"]);
  assert.deepEqual(names("count"), ["B0005", "A2004", "A1802", "B0005N", "c13011"]);
  assert.deepEqual(names("nonsense"), names("recent"));
  assert.equal(materials[0].material, "A2004", "sorting does not reorder the input");
  assert.deepEqual(model.SORT_OPTIONS.map((option) => option.key), ["recent", "name", "count"]);
});

test("the summary totals the rows and finds the newest test date", () => {
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

test("the time the sheet was last read is shown in Bangkok time with seconds", () => {
  assert.equal(model.formatUpdatedAt("2026-10-16T03:30:05+00:00"), "16/10/2026 10:30:05");
  assert.equal(model.formatUpdatedAt("2026-10-16T18:05:09Z"), "17/10/2026 01:05:09", "crosses midnight into the next Bangkok day");
  assert.equal(model.formatUpdatedAt(null), "—");
  assert.equal(model.formatUpdatedAt("not a date"), "—");
});
