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
  assert.equal(model.materialUrl("A1802"), "#/lab?module=mooney&material=A1802");
  assert.equal(model.materialUrl("E00030S T"), "#/lab?module=mooney&material=E00030S%20T");
  assert.equal(model.materialUrl("a&b=c#d"), "#/lab?module=mooney&material=a%26b%3Dc%23d");
  assert.equal(model.materialUrl(""), "#/lab?module=mooney", "no material = the Mooney material list");
  assert.equal(new URLSearchParams(model.materialUrl("a&b=c#d").split("?")[1]).get("material"), "a&b=c#d");
});

test("dashboard numbers come from the per-material summaries: materials, total results, latest test date", () => {
  const stats = model.overviewStats([
    { material: "A", resultCount: 12000, lastTested: "2026-10-01" },
    { material: "B", resultCount: 30, lastTested: "2026-10-18" },
    { material: "C", resultCount: 5, lastTested: "2026-10-18" },
    { material: "D", resultCount: "x", lastTested: null },
  ]);
  assert.deepEqual(stats, { materialCount: 4, resultCount: 12035, lastTested: "2026-10-18", latestMaterialCount: 2 });
  assert.deepEqual(model.overviewStats([]), { materialCount: 0, resultCount: 0, lastTested: null, latestMaterialCount: 0 });
  assert.deepEqual(model.overviewStats(undefined), { materialCount: 0, resultCount: 0, lastTested: null, latestMaterialCount: 0 });
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

test("months are read from the test date, listed oldest first once each, and shown as a short Thai month with the Gregorian year", () => {
  assert.equal(model.monthOf("2026-09-21"), "2026-09");
  assert.equal(model.monthOf("2026-12-01"), "2026-12");
  assert.equal(model.monthOf(null), null);
  assert.equal(model.monthOf("21/09/2026"), null, "only the sheet's ISO date is read");
  const items = ["2026-10-02", "2026-09-30", "2026-09-01", "2026-10-31", null, "2027-01-05"].map((testDate) => ({ testDate }));
  assert.deepEqual(model.monthsOf(items), ["2026-09", "2026-10", "2027-01"], "a month with no tests is not listed");
  assert.deepEqual(model.monthsOf([]), []);
  assert.equal(model.formatMonth("2026-09"), "ก.ย. 2026");
  assert.equal(model.formatMonth("2027-01"), "ม.ค. 2027");
  assert.equal(model.formatMonth("2026-12"), "ธ.ค. 2026");
  assert.equal(model.formatMonth("2026-13"), "—");
  assert.equal(model.formatMonth("2026-00"), "—");
  assert.equal(model.formatMonth(null), "—");
  assert.equal(model.formatMonth("21/09/2026"), "—");
});

/* ---------- สุขภาพของกระบวนการ (แดชบอร์ด) ---------- */

// วัสดุหนึ่งรายการ ชุดละ 3 แถว ค่าเฉลี่ย MV ของแต่ละชุดตาม averages (MH = MV + 20) วันละ 2 ชุด เริ่ม 1 ก.ย. 2026
function healthRows(averages, { material = "A2004", sd = 0.2, start = 1, overrides = () => ({}) } = {}) {
  const rows = [];
  averages.forEach((average, batch) => {
    const date = model.shiftDate("2026-09-01", start - 1 + Math.floor(batch / 2));
    for (let index = 0; index < 3; index += 1) {
      rows.push(feedRow({
        source_sheet: material, material, sample_id: String(100 + index), test_date: date,
        test_time: `${String(8 + (batch % 2)).padStart(2, "0")}:0${index}:00`,
        mv: average + (index - 1) * sd, avg_mv: average, sd_mv: sd,
        mh: average + 20 + (index - 1) * sd, avg_mh: average + 20, sd_mh: sd,
        ...overrides(batch, index),
      }));
    }
  });
  return rows;
}
const summaryOf = (rows) => model.buildMaterialSummaries(model.normalizeFeed({ rows }).rows);
// ค่าแกว่งรอบ 40 แบบไม่สุ่ม (ทดสอบซ้ำได้ผลเดิมทุกครั้ง)
const steady = (count) => Array.from({ length: count }, (_, index) => 40 + Math.sin(index * 1.7) * 0.5);

test("control limits follow the I-MR chart: centre = mean, sigma = average moving range / 1.128", () => {
  const limits = model.controlLimits([10, 12, 11, 13]);
  assert.equal(limits.mean, 11.5);
  assert.ok(Math.abs(limits.sigma - (5 / 3) / 1.128) < 1e-9);
  assert.ok(Math.abs(limits.ucl - (11.5 + 3 * limits.sigma)) < 1e-9);
  assert.ok(Math.abs(limits.lcl - (11.5 - 3 * limits.sigma)) < 1e-9);
  assert.equal(model.controlLimits([5]), null, "one value has no spread");
  assert.equal(model.controlLimits([5, 5, 5]), null, "identical values give sigma 0, no usable limits");
  assert.equal(model.controlLimits([5, null, "x"]), null, "non-numbers are ignored");
});

test("Western Electric rules fire only when the latest batch completes the pattern", () => {
  const limits = { mean: 0, sigma: 1 };
  assert.deepEqual(model.ruleSignals([0, 0, 3.5], limits), ["beyond3"]);
  assert.deepEqual(model.ruleSignals([0, -3.5], limits), ["beyond3"], "the lower side counts too");
  assert.deepEqual(model.ruleSignals([2.5, 0, 2.5], limits), ["twoOfThree"]);
  assert.deepEqual(model.ruleSignals([2.5, -2.5, -0.5, 2.5], limits), [], "two of three must be on the same side");
  assert.deepEqual(model.ruleSignals([2.5, 2.5, 0], limits), [], "a pattern that ended before the latest batch was reported in its own round");
  assert.deepEqual(model.ruleSignals([1.5, 1.5, 0, 1.5, 1.5], limits), ["fourOfFive"]);
  assert.deepEqual(model.ruleSignals([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], limits), ["eightSameSide"]);
  assert.deepEqual(model.ruleSignals([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], limits), [], "seven in a row is not enough");
  assert.deepEqual(model.ruleSignals([0, 0, 0], limits), []);
  assert.deepEqual(model.ruleSignals([1, 2], null), [], "no limits, no signals");
  assert.equal(model.zoneOf(3.01), "out");
  assert.equal(model.zoneOf(-2.5), "warn");
  assert.equal(model.zoneOf(2), "ok");
});

test("a material needs 10 batches for provisional limits and 40 for ready ones", () => {
  assert.equal(model.CONTROL_MIN_PROVISIONAL, 10);
  assert.equal(model.CONTROL_MIN_READY, 40);
  assert.deepEqual(summaryOf(healthRows(steady(9)))[0].health.mv, { level: "insufficient", count: 9 });
  const provisional = summaryOf(healthRows(steady(10)))[0].health.mv;
  assert.equal(provisional.level, "provisional");
  assert.equal(provisional.count, 10);
  const ready = summaryOf(healthRows(steady(45)))[0].health;
  assert.equal(ready.mv.level, "ready");
  assert.equal(ready.mv.recent.length, model.CONTROL_RECENT, "only the latest batches travel to the dashboard");
  assert.equal(ready.mv.signal, null);
  assert.equal(ready.mv.sdHigh, false);
  assert.equal(ready.mh.level, "ready");
  assert.ok(ready.mh.mean > ready.mv.mean + 19, "MH has its own limits");
});

test("the latest batch outside 3 sigma, and a wide spread inside the strand, are flagged from the material's own history", () => {
  const averages = [...steady(44), 46];
  const health = summaryOf(healthRows(averages, { overrides: (batch, index) => (batch === 44 ? { mv: 46 + (index - 1) * 2, sd_mv: 2 } : {}) }))[0].health;
  assert.deepEqual(health.mv.signal, { ago: 0, value: 46, rules: ["beyond3"], beyondBand: true, sd: 2 }, "46 is more than 5 MU from a centre of about 40");
  assert.equal(health.mv.band, model.PRACTICAL_BAND_MU);
  assert.equal(health.mh.band, null, "MH has no practical band");
  assert.equal(health.mh.signal.beyondBand, false);
  assert.equal(health.mv.sdHigh, true, "SD 2.0 against a history of 0.2");
  assert.equal(health.mv.latestSd, 2);
});

test("a breach stays on the list for the 12 batches the grid shows, even after normal batches follow", () => {
  // ไม่มีการแจ้งเตือนทางอื่น: ชุดที่เกินเส้นแล้วมีชุดปกติตามมาในวันเดียวกันต้องไม่หายจากรายการ
  const values = [...steady(44), 46, 40, 40.1];
  const limits = model.controlLimits(values);
  assert.deepEqual(model.latestSignal(values, limits), { ago: 2, value: 46, rules: ["beyond3"], beyondBand: false });
  assert.deepEqual(model.latestSignal(values, limits, 12, 5), { ago: 2, value: 46, rules: ["beyond3"], beyondBand: true });
  const health = summaryOf(healthRows(values))[0].health;
  const items = model.attentionItems([{ material: "A2004", lastTested: "2026-10-01", health }], "2026-10-01");
  assert.deepEqual(items.filter((item) => item.ago === 2).map((item) => [item.measure, item.kind, item.severity, item.high]), [["MV", "outOfBand", "out", true], ["MH", "rule", "warn", true]],
    "MV beyond ±5 MU is red; MH beyond 3σ is an amber early warning");
  const later = [...values, ...steady(12)];
  assert.equal(model.latestSignal(later, model.controlLimits(later)), null, "after 12 more batches it has left the grid and the list");
  assert.equal(model.latestSignal(values, null), null);
});

test("the strand SD is the latest batch's own, never a borrowed older value", () => {
  // ชุดล่าสุดมี AVG แต่ไม่มี SD: ต้องไม่เอา SD ของชุดก่อนหน้ามาเรียกว่า "ชุดล่าสุด"
  const health = summaryOf(healthRows(steady(12), { overrides: (batch) => ({ sd_mv: batch === 11 ? null : 0.2 + (batch % 3) * 0.05 }) }))[0].health;
  assert.equal(health.mv.latestSd, null);
  assert.equal(health.mv.sdHigh, false);
  assert.ok(Number.isFinite(health.mv.sdUcl));
});

test("mixed test conditions stop control limits instead of comparing different tests", () => {
  const rows = healthRows(steady(12), { overrides: (batch) => (batch === 3 ? { temperature_c: 125 } : {}) });
  const health = summaryOf(rows)[0].health;
  assert.equal(health.uniform, false);
  assert.deepEqual(health.mv, { level: "mixed", count: 12 });
  assert.deepEqual(health.mh, { level: "mixed", count: 12 });
});

test("batches whose sheet AVG does not belong to their readings are left out of the limits", () => {
  // ชุดที่ 5 มี AVG MV 4.0 ทั้งที่อ่านได้ราว 40 (สูตรในชีตอ้างช่วงผิด)
  const health = summaryOf(healthRows(steady(12), { overrides: (batch) => (batch === 5 ? { avg_mv: 4 } : {}) }))[0].health;
  assert.equal(health.mv.count, 11);
  assert.ok(health.mv.lcl > 30, "the bad AVG does not widen the limits");
  assert.equal(health.mh.count, 12, "MH of the same batch is still usable");
  assert.equal(model.sheetAverageFits(40.004, [40, 40.001]), true, "rounding to 2 places is tolerated");
  assert.equal(model.sheetAverageFits(4, [40, 41]), false);
  assert.equal(model.sheetAverageFits(null, [40]), false);
});

test("health records rows without AVG and the usual gap between test days", () => {
  const rows = healthRows(steady(8), { overrides: (batch) => (batch >= 6 ? { avg_mv: null, sd_mv: null, avg_mh: null, sd_mh: null } : {}) });
  const health = summaryOf(rows)[0].health;
  assert.deepEqual(health.missingAvg, { count: 6, oldest: "2026-09-04" });
  assert.equal(health.typicalGapDays, 1);
  assert.equal(health.days, undefined, "no daily-volume array travels with every feed any more");
  const single = summaryOf(healthRows(steady(2)))[0].health;
  assert.equal(single.typicalGapDays, null, "one or two test days do not show a usual gap yet");
});

test("dates in Bangkok time and day arithmetic do not drift with the browser time zone", () => {
  assert.equal(model.todayInBangkok(new Date("2026-10-21T17:30:00Z")), "2026-10-22", "00:30 in Bangkok is already the next day");
  assert.equal(model.todayInBangkok(new Date("2026-10-22T16:59:00Z")), "2026-10-22");
  assert.equal(model.shiftDate("2026-10-01", -1), "2026-09-30");
  assert.equal(model.shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(model.shiftDate("bad", 1), null);
  assert.equal(model.daysBetween("2026-09-30", "2026-10-02"), 2);
  assert.equal(model.daysBetween(null, "2026-10-02"), null);
});

test("names that differ only by case or spacing, or contain lower case, are reported for checking", () => {
  const issues = model.nameIssues([{ material: "C1301" }, { material: "c1301" }, { material: "c13011" }, { material: "E00030S B" }, { material: "E00030SB" }, { material: "B0005" }]);
  assert.deepEqual(issues.get("C1301"), { kind: "duplicate", others: ["c1301"] });
  assert.deepEqual(issues.get("c1301"), { kind: "duplicate", others: ["C1301"] });
  assert.deepEqual(issues.get("c13011"), { kind: "lowercase", others: [] });
  assert.deepEqual(issues.get("E00030S B"), { kind: "duplicate", others: ["E00030SB"] });
  assert.equal(issues.has("B0005"), false);
});

test("the attention list ranks out-of-control first and explains each data problem once", () => {
  const out = summaryOf(healthRows([...steady(44), 46], { material: "A2004", overrides: (batch) => ({ sd_mv: 0.2 + (batch % 3) * 0.05 }) }))[0];
  const mixed = summaryOf(healthRows(steady(3), { material: "E00030S B", overrides: (batch) => (batch === 1 ? { test_minutes: 8 } : {}) }))[0];
  const late = summaryOf(healthRows(steady(6), { material: "B0010" }))[0];
  const pending = summaryOf(healthRows(steady(2), { material: "B0006", overrides: (batch) => (batch === 1 ? { avg_mv: null, sd_mv: null, avg_mh: null, sd_mh: null } : {}) }))[0];
  const lower = { ...summaryOf(healthRows(steady(1), { material: "c13011" }))[0] };
  const items = model.attentionItems([late, mixed, out, pending, lower], "2026-10-22");
  assert.deepEqual(items.slice(0, 1).map((item) => [item.material, item.severity, item.kind, item.measure]), [["A2004", "out", "outOfBand", "MV"]]);
  const first = items[0];
  assert.equal(first.high, true);
  assert.equal(first.center, out.health.mv.mean);
  assert.equal(first.band, 5);
  assert.equal(first.ago, 0);
  assert.equal(first.strandStable, true, "the strand SD matches its history, so the cause is between lots");
  assert.ok(items.some((item) => item.material === "A2004" && item.kind === "rule" && item.measure === "MH" && item.signals.includes("beyond3")));
  assert.equal(first.provisional, false);
  const kinds = items.map((item) => `${item.material}:${item.kind}`);
  assert.ok(kinds.includes("E00030S B:mixed"));
  assert.ok(kinds.includes("B0006:missingAvg"));
  assert.ok(kinds.includes("c13011:lowercaseName"));
  assert.ok(kinds.includes("B0010:overdue"), "tested daily, then nothing for weeks");
  assert.equal(items.find((item) => item.kind === "overdue" && item.material === "B0010").days, 49, "last tested 3 Sep");
  assert.ok(!kinds.includes("c13011:overdue"), "one test day = unknown usual gap, not overdue");
  // แถวที่ยังไม่มี AVG ของวันนี้เป็นงานที่กำลังทำ ไม่ใช่ปัญหา
  assert.ok(!model.attentionItems([pending], "2026-09-01").some((item) => item.kind === "missingAvg"));
  assert.deepEqual(model.attentionItems([{ material: "OLD", resultCount: 1 }], "2026-10-22"), [], "summaries without health are skipped");
  assert.deepEqual(model.attentionItems(undefined, "2026-10-22"), []);
  assert.equal(model.hasHealth([out]), true);
  assert.equal(model.hasHealth([{ material: "OLD" }]), false);
});

test("materials for the control chart: ready first, then provisional, most history first", () => {
  const ready = summaryOf(healthRows(steady(45), { material: "B0005" }))[0];
  const readyMore = summaryOf(healthRows(steady(50), { material: "A2004" }))[0];
  const provisional = summaryOf(healthRows(steady(12), { material: "B0008" }))[0];
  const none = summaryOf(healthRows(steady(3), { material: "A1802" }))[0];
  assert.deepEqual(model.controlMaterials([none, provisional, ready, readyMore]).map((item) => item.material), ["A2004", "B0005", "B0008"]);
});

test("only ML(1+4) viscosity rows are analysed; rows of another test (e.g. scorch at 120-125 °C) are counted and left out", () => {
  // แบบ E00030S B ในข้อมูลจริง: 120 °C / 5 นาที และ 125 °C / 6 นาที ค่าเฉลี่ยราว 4 ซึ่งไม่ใช่ความหนืด
  const other = summaryOf(healthRows(steady(12).map((value) => value / 10), { material: "E00030S B", overrides: (batch) => ({ temperature_c: batch % 2 ? 125 : 120, test_minutes: batch % 2 ? 6 : 5 }) }))[0].health;
  assert.deepEqual(other.mv, { level: "otherTest", count: 0 });
  assert.equal(other.otherTestRows, 36);
  assert.equal(other.uniform, true, "no viscosity rows means nothing mixed among them");
  const items = model.attentionItems([{ material: "E00030S B", lastTested: "2026-09-06", health: other }], "2026-09-06");
  assert.deepEqual(items.map((item) => item.kind), ["otherTest"]);
  // วัสดุที่มีทั้งสองแบบ: วิเคราะห์เฉพาะแถว 4 นาที
  const both = summaryOf(healthRows(steady(14), { overrides: (batch) => (batch >= 12 ? { test_minutes: 6, temperature_c: 125 } : {}) }))[0].health;
  assert.equal(both.mv.level, "provisional");
  assert.equal(both.mv.count, 12);
  assert.equal(both.otherTestRows, 6);
  assert.equal(model.isViscosityTest({ testMinutes: 8 }), true, "butyl is read at 8 minutes");
  assert.equal(model.isViscosityTest({ testMinutes: null }), true, "a blank test time is not thrown away");
  assert.equal(model.isViscosityTest({ testMinutes: 5 }), false);
});

test("the machine check fires when at least 3 materials shift the same way on the same recent day", () => {
  const control = (value, date) => ({ level: "ready", mean: 40, sigma: 1, band: 5, recent: [40, 40.5, value], recentDates: ["2026-10-10", "2026-10-15", date] });
  const materials = ["A", "B", "C"].map((name) => ({ material: name, health: { mv: control(42.5, "2026-10-20") } }));
  assert.deepEqual(model.machineItems(materials, "2026-10-22"), [{ material: "", severity: "warn", kind: "machine", date: "2026-10-20", high: true, materials: ["A", "B", "C"] }]);
  assert.deepEqual(model.machineItems(materials.slice(0, 2), "2026-10-22"), [], "two materials are not enough");
  const mixed = [...materials.slice(0, 2), { material: "C", health: { mv: control(37.5, "2026-10-20") } }];
  assert.deepEqual(model.machineItems(mixed, "2026-10-22"), [], "opposite directions point to the materials, not the machine");
  assert.deepEqual(model.machineItems(materials, "2026-11-30"), [], "older than 14 days is out of scope");
  assert.ok(model.attentionItems(materials.map((item) => ({ ...item, lastTested: "2026-10-20" })), "2026-10-22").some((item) => item.kind === "machine"));
});

/* ---------- ตารางรายโม่ ---------- */

// วันเดียว สองโม่ แต่ละโม่สองเส้น เส้นละสามส่วน (ID = โม่ เส้น ส่วน แบบชีตจริง)
function millDay({ material = "B0005", date = "2026-10-14", mills = { 1: 49.5, 2: 49.7, 3: 54.6 }, mh = (mv) => mv + 28, tweak = () => ({}) } = {}) {
  const rows = [];
  for (const [mill, mv] of Object.entries(mills)) {
    for (const strand of [1, 2]) {
      for (const part of [1, 2, 3]) {
        const id = `${mill}${strand}${part}`;
        rows.push(feedRow({ source_sheet: material, material, sample_id: id, test_date: date, test_time: `0${mill}:${strand}${part}:00`,
          mv, mh: mh(mv), avg_mv: mv, sd_mv: 0.1, avg_mh: mh(mv), sd_mh: 0.1, ...tweak(id) }));
      }
    }
  }
  return rows;
}

test("sample IDs read as mill, strand and part", () => {
  assert.deepEqual(model.parseSampleId("412"), { mill: "4", strand: "1", part: "2" });
  assert.deepEqual(model.parseSampleId(" 3241 "), { mill: "3", strand: "2", part: "41" });
  assert.equal(model.parseSampleId("A12"), null);
  assert.equal(model.parseSampleId("12"), null);
});

test("each mill on a day is compared with that day's median of the same formula", () => {
  const mills = summaryOf(millDay())[0].health.mills;
  assert.deepEqual(mills.map((row) => [row.date, row.mill, row.count, row.mv, row.dMv]), [
    ["2026-10-14", "1", 6, 49.5, -0.2], ["2026-10-14", "2", 6, 49.7, 0], ["2026-10-14", "3", 6, 54.6, 4.9],
  ]);
  const third = mills[2];
  assert.equal(third.dMh, 4.9);
  assert.equal(third.points.length, 6, "every reading of mill 3 is 2 MU or more from the day's median");
  assert.deepEqual(third.points[0], ["311", 4.9, 4.9]);
  assert.deepEqual(mills[0].points, [], "small differences are not stored");
  const alone = summaryOf(millDay({ mills: { 1: 50 } }))[0].health.mills;
  assert.deepEqual(alone.map((row) => [row.dMv, row.points.length]), [[null, 0]], "one mill on a day has nothing to compare with");
});

test("mill rows keep only the last 45 days of the whole sheet, so the dashboard can show 14, 30 or 45 days without a new RPC", () => {
  const rows = [...millDay({ date: "2026-08-20" }), ...millDay({ date: "2026-10-14" }), ...millDay({ material: "A2004", date: "2026-08-31" })];
  const summaries = summaryOf(rows);
  assert.deepEqual([...new Set(summaries.find((item) => item.material === "B0005").health.mills.map((row) => row.date))], ["2026-10-14"]);
  assert.deepEqual(summaries.find((item) => item.material === "A2004").health.mills.map((row) => row.date)[0], "2026-08-31", "44 days before the sheet's latest test day is still in");
  assert.equal(model.MILL_DAYS, 45);
  assert.deepEqual(model.DASH_RANGES, [14, 30, 45]);
  assert.equal(model.DASH_DEFAULT_DAYS, 30);
  assert.equal(model.windowSince("2026-10-14", 14), "2026-10-01");
  assert.equal(model.windowSince("2026-10-14", 45), "2026-08-31");
  assert.equal(model.windowSince("2026-10-14", 7), "2026-09-15", "an unknown range falls back to the default 30 days");
});

test("the mill table judges each row with the chosen threshold and sorts the worst first", () => {
  const rows = [
    ...millDay(),
    ...millDay({ material: "A2004", date: "2026-10-13", mills: { 1: 44, 2: 44.5 }, tweak: (id) => (id === "121" ? { mv: 0 } : {}) }),
    ...millDay({ material: "B0006", date: "2026-10-12", mills: { 1: 50, 2: 55 } }),
  ];
  const materials = summaryOf(rows);
  const table = model.millTableRows(materials, "2026-10-14");
  assert.deepEqual(table.map((row) => [row.material, row.mill, row.status]), [
    ["A2004", "1", "data"], ["B0005", "3", "warn"], ["B0006", "1", "warn"], ["B0006", "2", "warn"],
  ], "a zero reading asks for a data check; then newest first");
  const third = table.find((row) => row.material === "B0005");
  assert.deepEqual(third.pattern, { kind: "mill" }, "all six points moved together");
  assert.equal(model.millTableRows(materials, "2026-10-14", { threshold: 5 }).filter((row) => row.status === "warn").length, 0, "nothing is 5 MU from its day's median");
  assert.equal(model.MILL_THRESHOLDS, undefined, "the threshold picker is gone with the filter table");
  assert.equal(model.millTableRows(materials, "2026-10-14", { status: "all" }).length, 7);
  assert.deepEqual(model.millTableRows(materials, "2026-10-14", { query: "b0006", status: "all" }).map((row) => row.mill), ["1", "2"]);
  assert.equal(model.millTableRows(materials, "2026-10-14", { days: 2, status: "all" }).length, 5, "7 days and 14 days count back from today");
  assert.equal(model.millTableRows(materials, "2026-11-30").length, 0, "older rows fall out of the window");
});

test("a mill more than 5 MU from the formula's centre is red even when its day looks alike", () => {
  const history = healthRows(steady(44), { material: "B0005" });
  const day = millDay({ material: "B0005", date: "2026-10-14", mills: { 1: 46.5, 2: 46.6 } });
  const [summary] = summaryOf([...history, ...day]);
  const rows = model.millTableRows([summary], "2026-10-14", { status: "all" }).filter((row) => row.date === "2026-10-14");
  assert.deepEqual(rows.map((row) => [row.mill, row.status]), [["1", "out"], ["2", "out"]]);
  assert.ok(rows[0].fromCenter > 5);
  const pattern = (points) => model.millPattern(points)?.kind ?? null;
  assert.equal(pattern([["111"], ["112"], ["113"]]), "strand");
  assert.equal(pattern([["111"], ["221"]]), "spot");
  assert.equal(pattern([]), null);
});

test("data notices hold the problems that belong to no single mill", () => {
  const other = summaryOf(healthRows(steady(3), { material: "E00030S B", overrides: () => ({ test_minutes: 6 }) }))[0];
  const kinds = model.dataNotices([other, { material: "c13011", lastTested: "2026-10-01", health: { mv: {}, mh: {}, uniform: true } }], "2026-10-14").map((item) => item.kind);
  assert.ok(kinds.includes("otherTest"));
  assert.ok(kinds.includes("lowercaseName"));
  assert.ok(!kinds.includes("outOfBand") && !kinds.includes("rule"), "process signals live in the table and the chart, not here");
});

/* ---------- แดชบอร์ด 4 ส่วน ---------- */

test("mill rows carry the strand spread: SD of head, middle and tail per strand, averaged per mill", () => {
  const rows = millDay({ mills: { 1: 50, 2: 50 }, tweak: (id) => (id.startsWith("21") ? { mv: 50 + (Number(id[2]) - 2) * 1.5 } : {}) });
  const [first, second] = summaryOf(rows)[0].health.mills;
  assert.deepEqual([first.strands, first.sdMean, first.sdMax, first.sdHigh], [2, 0, 0, 0]);
  assert.deepEqual([second.strands, second.sdMean, second.sdMax, second.sdHigh], [2, 0.75, 1.5, 1], "one strand spreads more than 1 MU");
  assert.equal(model.STRAND_SD_HIGH, 1);
});

test("daily rows weigh every piece, measure the spread between mills and judge the day against the formula's own limits", () => {
  const today = "2026-10-14";
  const rows = [
    ...healthRows(steady(44), { material: "B0005" }),
    ...millDay({ material: "B0005", date: "2026-10-12", mills: { 1: 40.1, 2: 40.3 } }),
    ...millDay({ material: "B0005", date: "2026-10-13", mills: { 1: 40, 2: 44 } }),
    ...millDay({ material: "B0005", date: today, mills: { 1: 46.5, 2: 46.6 } }),
  ];
  const [summary] = summaryOf(rows);
  const daily = model.dailyRows(summary, today, 14);
  assert.deepEqual(daily.map((day) => [day.date, day.mv, day.mills, day.count, day.spread, day.status]), [
    ["2026-10-12", 40.2, 2, 12, 0.2, "ok"], ["2026-10-13", 42, 2, 12, 4, "warn"], ["2026-10-14", 46.55, 2, 12, 0.1, "out"],
  ], "ok · the mills disagree by more than 3 MU · more than 5 MU from the centre");
  assert.deepEqual([daily[1].low, daily[1].high], [40, 44]);
  assert.deepEqual(daily.map((day) => day.suspect), [0, 0, 0]);
  assert.ok(Math.abs(daily[2].dev - (46.55 - summary.health.mv.mean)) < 0.011);
  assert.equal(daily[0].mh, 68.2);
  const alone = model.dailyRows({ health: { mills: [{ date: today, mill: "1", count: 6, mv: 50, mh: 80 }] } }, today, 14)[0];
  assert.deepEqual([alone.status, alone.spread, alone.low, alone.dev], ["none", null, null, null], "no limits and one mill = nothing to judge");
  assert.equal(model.dailyRows(summary, "2026-12-31", 14).length, 0, "the window counts back from today");
  assert.equal(model.dailyRows({ health: { mills: [] } }, today, 14).length, 0);
});

test("a mill with a zero reading is left out of the day's average, spread, bias and strand SD, and a day of only zeros asks for a data check", () => {
  const today = "2026-10-14";
  const zero = (mill) => (id) => (id.startsWith(mill) ? { mv: 0, mh: 0 } : {});
  const rows = [
    ...healthRows(steady(44), { material: "B0005" }),
    ...millDay({ material: "B0005", date: "2026-10-13", mills: { 1: 40.1, 2: 20, 3: 40.3 }, tweak: zero("2") }),
    ...millDay({ material: "B0005", date: today, mills: { 1: 40.2, 2: 40.4 }, tweak: (id) => ({ mv: 0, mh: 0 }) }),
  ];
  const materials = summaryOf(rows);
  const daily = model.dailyRows(materials[0], today, 14);
  assert.deepEqual(daily.map((day) => [day.date, day.mv, day.mills, day.suspect, day.spread, day.status]), [
    ["2026-10-13", 40.2, 2, 1, 0.2, "ok"], [today, null, 0, 2, null, "data"],
  ], "the zero mill does not drag the day to red; a day of zeros is a data check");
  const trend = model.trendItems(materials, today, 14);
  assert.equal(trend[0].severity, 1, "data ranks after out and before warn");
  assert.equal(trend[0].mhJump, null, "zeros do not fake an MH jump");
  const [item] = model.dashAttention(trend, materials, today);
  assert.deepEqual([item.kind, item.severity, item.suspect], ["dayData", "out", 2]);
  const bias = model.millBias(materials, today, 14);
  assert.deepEqual(Object.keys(bias.rows[0].cells), ["1", "3"], "the zero mill is not in the bias map");
  assert.deepEqual(model.strandUniformity(materials, today, 14).rows[0].cells["2"], undefined);
  assert.deepEqual(model.drillRows(materials[0], today, 14).map((row) => [row.mill, row.status]), [["1", "data"], ["2", "data"]], "the drill-down keeps the mill table's data check");
});

test("mill rows keep their out-of-line points only for the material's latest test day, so a 45-day snapshot stays small", () => {
  const rows = [...millDay({ date: "2026-10-01" }), ...millDay({ date: "2026-10-14" })];
  const mills = summaryOf(rows)[0].health.mills;
  assert.deepEqual(mills.map((row) => [row.date, row.mill, row.points.length]), [
    ["2026-10-01", "1", 0], ["2026-10-01", "2", 0], ["2026-10-01", "3", 0], ["2026-10-14", "1", 0], ["2026-10-14", "2", 0], ["2026-10-14", "3", 6],
  ]);
  assert.equal(mills[2].dMv, 4.9, "the difference from the day's median is still kept for every day");
});

// สูตรหลักมีประวัติพอตั้งเส้น วันล่าสุดเกิน ±5 · สูตรที่ MH กระโดด · สูตรเส้นชั่วคราวปกติ · สูตรใหม่ไม่มีเส้น
function dashboardRows(today = "2026-10-14") {
  const mh = (mv) => mv + 20;
  return [
    ...healthRows(steady(44), { material: "B0005" }), ...millDay({ material: "B0005", date: today, mills: { 1: 46.5, 2: 46.6 }, mh }),
    ...healthRows(steady(12), { material: "A2004" }), ...millDay({ material: "A2004", date: "2026-10-13", mills: { 1: 40.1, 2: 40.2 }, mh }),
    ...millDay({ material: "C1301", date: today, mills: { 1: 44, 2: 44.2 } }),
    ...millDay({ material: "B0008", date: "2026-10-10", mills: { 1: 50, 2: 50.2, 3: 50.1 }, mh: (mv) => mv + 25 }),
    ...millDay({ material: "B0008", date: "2026-10-11", mills: { 1: 50.2, 2: 50.1, 3: 50 }, mh: (mv) => mv + 25 }),
    ...millDay({ material: "B0008", date: today, mills: { 1: 50.3 }, mh: (mv) => mv + 60 }),
  ];
}

test("trend items rank the formula to look at first, flag a jump in MH and feed the latest-day cards and the attention list", () => {
  const today = "2026-10-14";
  const materials = summaryOf(dashboardRows(today));
  const trend = model.trendItems(materials, today, 30);
  assert.deepEqual(trend.map((item) => [item.material, item.latest.status, item.severity, item.level, Boolean(item.mhJump)]), [
    ["B0005", "out", 0, "ready", false], ["B0008", "none", 2, "insufficient", true], ["A2004", "ok", 3, "provisional", false], ["C1301", "none", 4, "insufficient", false],
  ], "worst day first (out, data check, warning), then formulas with limits, then the rest");
  const jump = trend[1].mhJump;
  assert.deepEqual([jump.value, jump.high, jump.date], [110.3, true, today]);
  assert.ok(jump.mean > 79 && jump.mean < 81);
  assert.equal(model.mhNote(materials.find((item) => item.material === "C1301")), null, "fewer than 6 mills = no MH reference");
  assert.equal(model.MH_MIN_MILLS, 6);
  assert.equal(model.MH_JUMP_MU, 10);
  assert.deepEqual(model.latestCards(trend).map((item) => item.material), ["B0005", "B0008", "C1301"], "A2004 was last tested the day before");
  assert.deepEqual(model.latestCards([]), []);
  const attention = model.dashAttention(trend, materials, today);
  assert.deepEqual(attention.map((item) => [item.material, item.kind, item.severity]), [["B0005", "dayOut", "out"], ["B0008", "mhJump", "warn"]]);
  assert.deepEqual([attention[0].value, attention[0].spread, attention[0].mills, attention[0].date], [46.55, 0.1, 2, today]);
  assert.equal(model.trendItems([{ material: "old", lastTested: today }], today, 30).length, 0, "summaries without health (older sync worker) are skipped");
  assert.equal(model.trendItems(materials, "2026-12-31", 14).length, 0);
});

test("a day whose mills disagree is a warning with the spread, and a day beyond 3 sigma but inside 5 MU is a rule warning", () => {
  const today = "2026-10-14";
  const rows = [...healthRows(steady(44), { material: "B0005" }), ...millDay({ material: "B0005", date: today, mills: { 1: 40, 2: 44 }, mh: (mv) => mv + 20 })];
  const materials = summaryOf(rows);
  const trend = model.trendItems(materials, today, 14);
  const [spread] = model.dashAttention(trend, materials, today);
  assert.deepEqual([spread.kind, spread.spread, spread.severity], ["daySpread", 4, "warn"]);
  const steadyRows = [...healthRows(steady(44), { material: "B0005" }), ...millDay({ material: "B0005", date: today, mills: { 1: 43, 2: 43.2 }, mh: (mv) => mv + 20 })];
  const steadyMaterials = summaryOf(steadyRows);
  const [rule] = model.dashAttention(model.trendItems(steadyMaterials, today, 14), steadyMaterials, today);
  assert.deepEqual([rule.kind, rule.severity, rule.value], ["dayRule", "warn", 43.1]);
  assert.ok(rule.dev > 2 && rule.dev < 5);
});

test("the mill heatmaps accumulate each mill's difference from its day and its strand spread over the window, and the drill-down lists the latest day", () => {
  const today = "2026-10-14";
  const rows = [
    ...millDay({ material: "B0005", date: "2026-10-13", mills: { 1: 49, 2: 50, 3: 53 } }),
    ...millDay({ material: "B0005", date: today, mills: { 1: 50, 3: 51 } }),
    ...millDay({ material: "A2004", date: today, mills: { 1: 44, 2: 44, 3: 46 }, tweak: (id) => (id === "313" ? { mv: 49 } : {}) }),
    ...millDay({ material: "C1301", date: today, mills: { 1: 44 } }),
  ];
  const materials = summaryOf(rows);
  const bias = model.millBias(materials, today, 14);
  assert.deepEqual(bias.mills, ["1", "2", "3"]);
  assert.deepEqual(bias.rows.map((row) => [row.material, row.days]), [["B0005", 5], ["A2004", 3]], "a lone mill has nothing to compare with, so C1301 is absent");
  const cells = bias.rows[0].cells;
  assert.deepEqual([cells["1"].delta, cells["1"].days, cells["2"].delta, cells["3"].delta], [-0.75, 2, 0, 1.75]);
  assert.deepEqual(cells["1"].detail, [{ date: "2026-10-13", delta: -1 }, { date: "2026-10-14", delta: -0.5 }]);
  assert.deepEqual(bias.rows[1].cells["3"], { delta: 2.5, days: 1, detail: [{ date: today, delta: 2.5 }] });
  assert.deepEqual(bias.total, { 1: { delta: -0.5, days: 3 }, 2: { delta: 0, days: 2 }, 3: { delta: 2, days: 3 } });
  assert.deepEqual(model.millBias(materials, "2026-12-31", 14).rows, []);
  const uniform = model.strandUniformity(materials, today, 14);
  assert.deepEqual(uniform.rows.map((row) => [row.material, row.strands]), [["B0005", 10], ["A2004", 6], ["C1301", 2]]);
  assert.deepEqual(uniform.rows[1].cells["3"], { sd: 0.87, strands: 2, high: 1, max: 1.73 });
  assert.deepEqual(uniform.rows[1].cells["1"], { sd: 0, strands: 2, high: 0, max: 0 });
  assert.deepEqual(model.strandUniformity([{ material: "old", health: { mills: [{ date: today, mill: "1", count: 6, mv: 50, mh: 80, dMv: null }] } }], today, 14).rows, [], "mill rows from the older sync worker have no strand spread");
  const drill = model.drillRows(materials.find((item) => item.material === "A2004"), today, 14);
  assert.deepEqual(drill.map((row) => [row.mill, row.status, row.sdMax]), [["1", "ok", 0], ["2", "ok", 0], ["3", "sdHigh", 1.73]], "a normal mill with an uneven strand is flagged");
  assert.deepEqual(model.drillRows(materials.find((item) => item.material === "B0005"), today, 14).map((row) => [row.date, row.mill, row.status]), [[today, "1", "ok"], [today, "3", "ok"]], "only the latest day");
  assert.deepEqual(model.drillRows({ material: "x" }, today, 14), []);
  assert.deepEqual(model.drillRows(materials[0], "2026-12-31", 14), []);
});
