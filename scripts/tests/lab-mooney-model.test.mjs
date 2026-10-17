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
    problems: ["A แถว 2: เวลาไม่ถูกต้อง"],
    skipped: ["Summary"],
  });
  assert.equal(feed.generatedAt, "2026-10-16T03:30:05+00:00");
  assert.equal(feed.rows.length, 1);
  assert.deepEqual(feed.rows[0], {
    id: "A1802|111|2026-09-21|08:29:13", sheet: "A1802", material: "A1802", sampleId: "111", testDate: "2026-09-21", testTime: "08:29:13",
    temperature: 100, testMinutes: 4, mh: 50.79, mv: 31.39, avgMh: null, sdMh: null, avgMv: null, sdMv: null,
  });
  assert.deepEqual(feed.skipped, ["Summary"]);
  assert.equal("problems" in feed || "problemCount" in feed, false, "the page does not carry or show the sheet's unreadable-row list");
  assert.deepEqual(model.normalizeFeed(null), { generatedAt: null, rows: [], skipped: [] });
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

test("search suggestions list names that start with the query first, then the other matches by name, without touching the input", () => {
  const names = (query, list = materials) => model.suggestMaterials(list, query).map((item) => item.material);
  assert.deepEqual(names(""), ["A1802", "A2004", "B0005", "B0005N", "c13011"], "no query lists every material by name");
  assert.deepEqual(names("  B000 "), ["B0005", "B0005N"], "the same matching as the table: trimmed and case-insensitive");
  assert.deepEqual(names("zzz"), []);
  const list = [{ material: "XA22" }, { material: "A2203" }, { material: "A22" }, { material: "B9" }];
  assert.deepEqual(names("a22", list), ["A22", "A2203", "XA22"]);
  assert.deepEqual(list.map((item) => item.material), ["XA22", "A2203", "A22", "B9"], "the caller's order is kept");
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

/* ---------- ลำดับการทดสอบ ชุดทดสอบ และสถิติของหน้าวัสดุ ---------- */

// แถวจากชีตตามลำดับในแท็บ: ชุดละ 3 แถว (AVG/SD ถูกขยายไปทุกแถวของชุดโดย Apps Script)
const grouped = (stats, ids, extra = {}) => ids.map((id, index) => feedRow({
  sample_id: id, test_time: `08:0${index}:00`, mh: 50 + index, mv: 30 + index,
  avg_mh: stats[0], sd_mh: stats[1], avg_mv: stats[2], sd_mv: stats[3], ...extra,
}));

function sampleRows() {
  return model.normalizeFeed({ rows: [
    ...grouped([50.5, 0.5, 30.5, 0.5], ["111", "112", "113"], { test_date: "2026-09-21" }),
    ...grouped([60.2, 1.1, 35.1, 0.2], ["121", "122", "123"], { test_date: "2026-09-21" }),
    feedRow({ sample_id: "211", test_date: "2026-09-22", test_time: "09:00:00", mh: 70, mv: 40, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null }),
    feedRow({ material: "B0005", source_sheet: "B0005", sample_id: "111", mh: 80, mv: 45 }),
  ] }).rows;
}

test("a material's series keeps the sheet order and numbers the tests from 1", () => {
  const rows = sampleRows();
  const series = model.buildSeries(rows, " A1802 ");
  assert.equal(series.material, "A1802");
  assert.deepEqual(series.items.map((item) => [item.seq, item.sampleId]), [[1, "111"], [2, "112"], [3, "113"], [4, "121"], [5, "122"], [6, "123"], [7, "211"]]);
  assert.equal(rows.find((row) => row.sampleId === "111").seq, undefined, "the feed rows are not modified");
  assert.deepEqual(model.buildSeries(rows, "NOPE").items, []);
  assert.deepEqual(model.buildSeries(rows, "").groups, []);
});

test("consecutive rows sharing the same AVG/SD form one test group; rows without stats stand alone", () => {
  const { groups, items } = model.buildSeries(sampleRows(), "A1802");
  assert.deepEqual(groups.map((group) => [group.count, group.start, group.hasStats]), [[3, 0, true], [3, 3, true], [1, 6, false]]);
  assert.deepEqual(items.map((item) => item.groupIndex), [0, 0, 0, 1, 1, 1, 2]);
  assert.equal(groups[0].avgMh, 50.5, "the sheet's own AVG is used, never recomputed");
  assert.equal(groups[1].sdMv, 0.2);
  assert.deepEqual([groups[0].firstDate, groups[0].lastDate], ["2026-09-21", "2026-09-21"]);
  assert.equal(groups[2].avgMh, null);
});

test("a group never spans two sheets or two different stat sets, even when the numbers look alike", () => {
  const rows = model.normalizeFeed({ rows: [
    ...grouped([50, 1, 30, 1], ["111", "112"], { source_sheet: "T1", material: "M" }),
    ...grouped([50, 1, 30, 1], ["111", "112"], { source_sheet: "T2", material: "M" }),
    ...grouped([50, 1, 30, 2], ["121"], { source_sheet: "T2", material: "M" }),
  ] }).rows;
  assert.deepEqual(model.buildSeries(rows, "M").groups.map((group) => group.count), [2, 2, 1]);
});

test("descriptive statistics use n−1 like Excel's STDEV and ignore missing values", () => {
  const stats = model.describe([2, 4, 4, 4, 5, 5, 7, 9, null, undefined, NaN]);
  assert.equal(stats.count, 8);
  assert.equal(stats.mean, 5);
  assert.ok(Math.abs(stats.sd - 2.138089935) < 1e-8);
  assert.deepEqual([stats.min, stats.max], [2, 9]);
  assert.deepEqual(model.describe([3]), { count: 1, mean: 3, sd: null, min: 3, max: 3 });
  assert.deepEqual(model.describe([]), { count: 0, mean: null, sd: null, min: null, max: null });
  assert.equal(model.describe(Array.from({ length: 200000 }, (_, i) => i)).max, 199999, "very long lists do not overflow the stack");
});

test("axis scales use round steps, cover the data and survive a single value", () => {
  assert.deepEqual(model.niceScale(51.08, 129.54), { min: 40, max: 140, step: 20, ticks: [40, 60, 80, 100, 120, 140] });
  assert.deepEqual(model.niceScale(0, 129.54, 3).ticks, [0, 50, 100, 150]);
  const flat = model.niceScale(5, 5);
  assert.ok(flat.min < 5 && flat.max > 5 && flat.ticks.length >= 3);
  assert.deepEqual(model.niceScale(0.1, 0.3, 4).ticks, [0.1, 0.15, 0.2, 0.25, 0.3].map((v) => v), "no floating-point noise in ticks");
  const none = model.niceScale(null, null);
  assert.ok(Number.isFinite(none.min) && Number.isFinite(none.max) && none.max > none.min);
  assert.deepEqual(model.niceScale(9, 3).ticks, model.niceScale(3, 9).ticks, "reversed bounds are tolerated");
});

test("date marks find the first test of each day in sheet order", () => {
  const items = [{ testDate: "2026-09-21" }, { testDate: "2026-09-21" }, { testDate: "2026-09-22" }, { testDate: "2026-09-21" }];
  assert.deepEqual(model.dateMarks(items), [{ index: 0, date: "2026-09-21" }, { index: 2, date: "2026-09-22" }, { index: 3, date: "2026-09-21" }]);
  assert.deepEqual(model.dateMarks([]), []);
});

test("IDs are listed in numeric order with their counts, and one ID's history carries the change since its previous test", () => {
  const items = model.buildSeries(model.normalizeFeed({ rows: [
    feedRow({ sample_id: "112", test_date: "2026-09-14", mh: 80, mv: 40 }),
    feedRow({ sample_id: "111", test_date: "2026-09-14", mh: 81, mv: 41 }),
    feedRow({ sample_id: "111", test_date: "2026-09-17", mh: 79.5, mv: 40.5 }),
    feedRow({ sample_id: "111", test_date: "2026-09-18", mh: null, mv: 40.75 }),
    feedRow({ sample_id: "9", test_date: "2026-09-18", mh: 1, mv: 1 }),
  ] }).rows, "A1802").items;
  assert.deepEqual(model.idsFor(items), [{ id: "9", count: 1 }, { id: "111", count: 3 }, { id: "112", count: 1 }]);
  const history = model.idSeries(items, "111");
  assert.deepEqual(history.map((row) => row.order), [1, 2, 3]);
  assert.deepEqual(history.map((row) => row.deltaMh), [null, -1.5, null], "no change is invented across a missing reading");
  assert.deepEqual(history.map((row) => row.deltaMv), [null, -0.5, 0.25]);
  assert.deepEqual(model.idSeries(items, "nope"), []);
});

test("the latest result is the sheet's last group with its change from the previous group", () => {
  const latest = model.latestOf(model.buildSeries(sampleRows().filter((row) => row.sampleId !== "211"), "A1802"));
  assert.equal(latest.item.sampleId, "123");
  assert.deepEqual(latest.mh, { basis: "group", value: 60.2, sd: 1.1, delta: 9.7 });
  assert.deepEqual(latest.mv, { basis: "group", value: 35.1, sd: 0.2, delta: 4.6 });
});

test("when the newest rows have no AVG yet the latest single readings are shown and labelled as such", () => {
  const latest = model.latestOf(model.buildSeries(sampleRows(), "A1802"));
  assert.deepEqual(latest.mh, { basis: "reading", value: 70, sd: null, delta: 70 - 52 });
  assert.equal(latest.mv.basis, "reading");
  assert.equal(model.latestOf(model.buildSeries([], "A1802")), null);
  const single = model.latestOf(model.buildSeries(model.normalizeFeed({ rows: [feedRow({ avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null })] }).rows, "A1802"));
  assert.equal(single.mh.delta, null, "the first ever test has nothing to compare with");
});

test("trends use the group averages, newest last, capped, and fall back to single readings", () => {
  const series = model.buildSeries(sampleRows(), "A1802");
  assert.deepEqual(model.trendOf(series, "mh"), [50.5, 60.2]);
  assert.deepEqual(model.trendOf(series, "mv", 1), [35.1]);
  const bare = model.buildSeries(model.normalizeFeed({ rows: [
    feedRow({ avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null, mh: 1, mv: 2 }),
    feedRow({ avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null, mh: 3, mv: 4, sample_id: "112" }),
  ] }).rows, "A1802");
  assert.deepEqual(model.trendOf(bare, "mh"), [1, 3]);
});

test("the overview carries the latest group, trends and group counts for every material", () => {
  const summaries = model.buildMaterialSummaries(sampleRows());
  assert.equal(summaries.length, 2);
  const a = summaries.find((item) => item.material === "A1802");
  assert.equal(a.resultCount, 7);
  assert.equal(a.groupCount, 3);
  assert.equal(a.latest.item.sampleId, "211");
  assert.deepEqual(a.trendMh, [50.5, 60.2]);
  assert.equal(summaries.find((item) => item.material === "B0005").latest.mh.value, 50.33, "a material with a single test uses the sheet's own stats");
  assert.deepEqual(model.sortMaterials(summaries, "name").map((item) => item.material), ["A1802", "B0005"], "the existing sort and search keep working on the richer rows");
  assert.deepEqual(model.buildMaterialSummaries([]), []);
});

test("test conditions are shown once when every row shares them", () => {
  assert.deepEqual(model.testConditions([{ temperature: 100, testMinutes: 4 }, { temperature: 100, testMinutes: 4 }]), { temperatures: [100], minutes: [4], uniform: true });
  const mixed = model.testConditions([{ temperature: 100, testMinutes: 4 }, { temperature: 145, testMinutes: 4 }]);
  assert.equal(mixed.uniform, false);
  assert.deepEqual(mixed.temperatures, [100, 145]);
  assert.equal(model.testConditions([]).uniform, true);
});

test("the data signature changes when a shown value changes and not otherwise", () => {
  const rows = sampleRows();
  const base = model.feedSignature(rows);
  assert.equal(model.feedSignature(sampleRows()), base);
  assert.notEqual(model.feedSignature(rows.map((row, index) => (index === 3 ? { ...row, mh: row.mh + 0.01 } : row))), base);
  assert.notEqual(model.feedSignature(rows.slice(1)), base);
  assert.notEqual(model.feedSignature(rows.map((row, index) => (index === 0 ? { ...row, avgMh: 99 } : row))), base);
});

test("copied tables are tab separated and cannot be broken by tabs or line breaks inside a cell", () => {
  assert.equal(model.toTsv([["a", "b"], ["1\t2", "x\ny"], [null, 3]]), "a\tb\n1 2\tx y\n\t3");
  assert.equal(model.toTsv([]), "");
});

test("signed differences and short dates read naturally and never guess", () => {
  assert.equal(model.formatSigned(1.234), "+1.23");
  assert.equal(model.formatSigned(-2.5), "−2.50");
  assert.equal(model.formatSigned(-0.004), "0.00", "rounds to zero without a sign");
  assert.equal(model.formatSigned(null), "—");
  assert.equal(model.formatShortDate("2026-09-21"), "21/09");
  assert.equal(model.formatShortDate("21/09/2026"), "—");
});

test("the last-read time is shown as a clock only, because the date is always today", () => {
  assert.equal(model.formatUpdatedTime("2026-10-16T03:30:05+00:00"), "10:30:05");
  assert.equal(model.formatUpdatedTime("2026-10-16T18:05:09Z"), "01:05:09");
  assert.equal(model.formatUpdatedTime(null), "—");
  assert.equal(model.formatUpdatedTime("not a date"), "—");
});

test("the 'last N days' chart range starts at the first test within N days of the newest test date, counting that day", () => {
  const items = ["2026-09-01", "2026-09-10", "2026-09-10", "2026-09-30", "2026-10-01"].map((testDate) => ({ testDate }));
  assert.equal(model.startOfLastDays(items, 30), 1, "30 days ending 2026-10-01 begin on 2026-09-02");
  assert.equal(model.startOfLastDays(items, 31), 0, "31 days reach back to 2026-09-01");
  assert.equal(model.startOfLastDays(items, 2), 3, "the newest day and the day before it");
  assert.equal(model.startOfLastDays(items, 1), 4, "the newest day only");
  assert.equal(model.startOfLastDays(items, 0), 4, "a non-positive count still means the newest day");
  assert.equal(model.startOfLastDays([], 30), 0);
  assert.equal(model.startOfLastDays([{ testDate: null }], 30), 0, "rows without a date give the whole list");
});
